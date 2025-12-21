import { readdir } from "node:fs/promises";

import { analyzeSeries } from "./analyze";
import { loadAnalysisConfig, loadSymbols } from "./config";
import { YahooMarketDataProvider } from "./providers/yahoo";
import { buildMarketReport, buildReportMdx } from "./report";
import {
  ensureDirs,
  getAnalysisDir,
  getDataDir,
  readJson,
  writeReport,
  writeAnalyzedSeries,
  writeRawSeries
} from "./storage";
import type { AnalyzedSeries, MarketInterval, RawSeries } from "./types";

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
}> {
  await ensureDirs(date);

  const provider = new YahooMarketDataProvider();
  const cfg = await loadAnalysisConfig();
  const symbols = await loadSymbols();
  const intervals = cfg.intervals;

  const tasks = symbols.flatMap((symbol) => intervals.map((interval) => ({ symbol, interval })));
  let written = 0;
  const missing = new Set<string>();

  await mapWithConcurrency(tasks, opts, async ({ symbol, interval }) => {
    try {
      const series = await provider.fetchSeries(symbol, interval, date);
      if (series.bars.length === 0) {
        missing.add(symbol);
        return;
      }
      await writeRawSeries(date, series);
      written += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[market:data] failed for ${symbol} ${interval} (${date}): ${message}`);
      missing.add(symbol);
    }
  });

  return { symbols, intervals, missingSymbols: Array.from(missing).sort(), written };
}

export async function runMarketAnalyze(date: string): Promise<{ analyzed: number }> {
  await ensureDirs(date);

  const cfg = await loadAnalysisConfig();
  const dir = getDataDir(date);
  const entries = await readdir(dir);
  const files = entries.filter((e) => e.endsWith(".json"));

  let analyzed = 0;
  for (const file of files) {
    const raw = await readJson<RawSeries>(`${dir}/${file}`);
    const analyzedSeries = analyzeSeries(raw)(cfg);
    await writeAnalyzedSeries(date, analyzedSeries);
    analyzed += 1;
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
    out.push(await readJson<AnalyzedSeries>(`${dir}/${file}`));
  }

  return out;
}

export async function runMarketReport(args: {
  date: string;
  symbols: string[];
  intervals: MarketInterval[];
  missingSymbols?: string[];
}): Promise<{ wrote: boolean }> {
  await ensureDirs(args.date);
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
    intervals: data.intervals,
    missingSymbols: data.missingSymbols
  });

  return {
    wroteData: data.written,
    analyzed: analysis.analyzed,
    wroteReport: report.wrote,
    missingSymbols: data.missingSymbols
  };
}
