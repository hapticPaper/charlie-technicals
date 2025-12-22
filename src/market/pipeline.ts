import { readdir } from "node:fs/promises";
import path from "node:path";

import { analyzeSeries } from "./analyze";
import { loadAnalysisConfig, loadSymbols } from "./config";
import { YahooMarketDataProvider } from "./providers/yahoo";
import { buildMarketReport, buildReportMdx } from "./report";
import {
  ensureAnalysisDir,
  ensureDataDir,
  ensureReportsDir,
  getAnalysisDir,
  loadRawSeriesWindow,
  newsSnapshotExists,
  readJson,
  writeReport,
  writeAnalyzedSeries,
  writeNewsSnapshot,
  writeRawSeries
} from "./storage";
import type { AnalyzedSeries, MarketInterval } from "./types";

type ConcurrencyOptions = {
  concurrency?: number;
};

async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  opts: ConcurrencyOptions,
  fn: (item: TIn) => Promise<TOut>
): Promise<TOut[]> {
  // NOTE: If you want best-effort behavior (partial progress), ensure `fn` handles
  // per-item errors internally. Unhandled rejections will fail the whole run.
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }

      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function runMarketData(date: string, opts: ConcurrencyOptions = {}): Promise<{
  symbols: string[];
  intervals: MarketInterval[];
  missingSymbols: string[];
  written: number;
  skippedExisting: number;
  newsWritten: number;
  newsSkippedExisting: number;
  newsFailedSymbols: string[];
}> {
  await ensureDataDir();

  const provider = new YahooMarketDataProvider();
  const cfg = await loadAnalysisConfig();
  const symbols = await loadSymbols();
  const intervals = cfg.intervals;

  const tasks = symbols.flatMap((symbol) => intervals.map((interval) => ({ symbol, interval })));

  const seriesResults = await mapWithConcurrency(tasks, opts, async ({ symbol, interval }) => {
    try {
      const series = await provider.fetchSeries(symbol, interval, date);
      if (series.bars.length === 0) {
        return { symbol, status: "missing" as const };
      }

      const res = await writeRawSeries(date, series);
      return { symbol, status: res.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[market:data] failed for ${symbol} ${interval} (${date}): ${message}`);
      return { symbol, status: "missing" as const };
    }
  });

  const missing = new Set<string>(
    seriesResults.filter((r) => r.status === "missing").map((r) => r.symbol)
  );

  const written = seriesResults.filter((r) => r.status === "written").length;
  const skippedExisting = seriesResults.filter((r) => r.status === "skipped_existing").length;

  const baseConcurrency = opts.concurrency ?? 4;
  const newsConcurrency = Math.max(1, Math.min(Math.floor(baseConcurrency / 2), 4));

  const newsResults = await mapWithConcurrency(symbols, { concurrency: newsConcurrency }, async (symbol) => {
    try {
      if (await newsSnapshotExists(date, symbol)) {
        return { symbol, status: "skipped_existing" as const };
      }

      const snapshot = await provider.fetchNews(symbol, date);
      const res = await writeNewsSnapshot(date, snapshot);
      return { symbol, status: res.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[market:news] failed for ${symbol} (${date}): ${message}`);
      return { symbol, status: "failed" as const };
    }
  });

  const newsWritten = newsResults.filter((r) => r.status === "written").length;
  const newsSkippedExisting = newsResults.filter((r) => r.status === "skipped_existing").length;
  const newsFailedSymbols = newsResults
    .filter((r) => r.status === "failed")
    .map((r) => r.symbol)
    .sort();

  return {
    symbols,
    intervals,
    missingSymbols: Array.from(missing).sort(),
    written,
    skippedExisting,
    newsWritten,
    newsSkippedExisting,
    newsFailedSymbols
  };
}

export async function runMarketAnalyze(date: string): Promise<{ analyzed: number }> {
  await ensureAnalysisDir(date);

  const cfg = await loadAnalysisConfig();
  const symbols = await loadSymbols();
  const intervals = cfg.intervals;

  // Raw data layout:
  //   content/data/<SYMBOL>/<INTERVAL>/<YYYYMMDD>.json
  // See `src/market/dataConventions.ts`.

  const legacyDir = path.join(process.cwd(), "content", "data", date);
  let legacyHasJson = false;
  try {
    const legacyEntries = await readdir(legacyDir);
    legacyHasJson = legacyEntries.some((e) => e.endsWith(".json"));
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code !== "ENOENT") {
      throw error;
    }
  }

  const tasks = symbols.flatMap((symbol) => intervals.map((interval) => ({ symbol, interval })));
  const results = await mapWithConcurrency(tasks, {}, async ({ symbol, interval }) => {
    const res = await loadRawSeriesWindow(date, symbol, interval);
    if (res.status !== "ok") {
      return { ...res, symbol, interval };
    }

    try {
      const analyzedSeries = analyzeSeries(res.series)(cfg);
      await writeAnalyzedSeries(date, analyzedSeries);
      return { status: "ok" as const, symbol, interval };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[market:analyze] Failed processing ${symbol} ${interval}: ${message}`);
    }
  });

  const insufficients = results.filter(
    (r): r is Extract<typeof r, { status: "insufficient_window" }> => r.status === "insufficient_window"
  );
  const analyzed = results.filter((r) => r.status === "ok").length;

  if (insufficients.length > 0) {
    const examples = insufficients
      .slice(0, 5)
      .map(
        (i) =>
          `${i.symbol} ${i.interval} (have ${i.selectedFiles.length}, need >= ${i.requiredMinFiles})`
      )
      .join(", ");
    throw new Error(
      `[market:analyze] insufficient raw window for ${insufficients.length} symbol/interval pairs; examples: ${examples}`
    );
  }

  if (analyzed === 0) {
    if (legacyHasJson) {
      throw new Error(
        `Legacy raw data layout detected at ${legacyDir} and no new-layout data found for ${date}. Re-run "market:data --date=${date}" to regenerate raw snapshots using content/data/<SYMBOL>/<INTERVAL>/<YYYYMMDD>.json, then delete ${legacyDir}.`
      );
    }

    throw new Error(`No data found for ${date}. Run "market:data --date=${date}" first.`);
  }

  if (legacyHasJson) {
    console.error(
      `[market:analyze] legacy raw data layout detected at ${legacyDir} (ignored); delete it to avoid confusion.`
    );
  }

  return { analyzed };
}

export async function loadAnalyzedSeries(date: string): Promise<AnalyzedSeries[]> {
  const dir = getAnalysisDir(date);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === "ENOENT") {
      throw new Error(`No analysis data found for ${date}. Run "market:analyze --date=${date}" first.`);
    }

    throw error;
  }
  const files = entries.filter((e) => e.endsWith(".json"));
  const out: AnalyzedSeries[] = [];

  for (const file of files) {
    const filePath = `${dir}/${file}`;
    try {
      out.push(await readJson<AnalyzedSeries>(filePath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[market:loadAnalyzedSeries] Failed reading ${filePath}: ${message}`);
    }
  }
  return out;
}

export async function runMarketReport(args: {
  date: string;
  symbols: string[];
  intervals: MarketInterval[];
  missingSymbols?: string[];
}): Promise<{ wrote: boolean }> {
  await ensureReportsDir();
  const analyzed = await loadAnalyzedSeries(args.date);

  const missingSymbols =
    args.missingSymbols ??
    args.symbols.filter((s) => !analyzed.some((a) => a.symbol === s));

  const report = buildMarketReport({
    date: args.date,
    symbols: args.symbols,
    intervals: args.intervals,
    analyzed,
    missingSymbols
  });
  const mdx = buildReportMdx(report);
  await writeReport(args.date, report, mdx);
  return { wrote: true };
}

export async function runMarketAll(date: string): Promise<{
  wroteData: number;
  analyzed: number;
  wroteReport: boolean;
  missingSymbols: string[];
}> {
  const data = await runMarketData(date);
  const analysis = await runMarketAnalyze(date);
  const report = await runMarketReport({
    date,
    symbols: data.symbols,
    intervals: data.intervals
  });

  return {
    wroteData: data.written,
    analyzed: analysis.analyzed,
    wroteReport: report.wrote,
    missingSymbols: data.missingSymbols
  };
}
