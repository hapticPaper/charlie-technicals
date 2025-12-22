import { readdir } from "node:fs/promises";

import { analyzeSeries } from "./analyze";
import { loadAnalysisConfig, loadSymbols } from "./config";
import { YahooMarketDataProvider } from "./providers/yahoo";
import { buildAnalysisMdx } from "./analysisMdx";
import { buildMarketReport, buildReportMdx } from "./report";
import {
  ensureDirs,
  getAnalysisDir,
  getDataDir,
  readJson,
  writeAnalysisPage,
  writeReport,
  writeAnalyzedSeries,
  writeRawSeries
} from "./storage";
import type { AnalysisIntervalSummary, AnalyzedSeries, MarketAnalysisSummary, MarketInterval, RawSeries } from "./types";

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
  const universeSymbols = await loadSymbols();
  const intervals = cfg.intervals;
  const dir = getDataDir(date);
  const entries = await readdir(dir);
  const files = entries.filter((e) => e.endsWith(".json"));

  if (files.length === 0) {
    throw new Error(`No data found for ${date}. Run "market:data --date=${date}" first.`);
  }

  let analyzed = 0;
  const series: Record<string, Partial<Record<MarketInterval, AnalysisIntervalSummary>>> = {};
  for (const file of files) {
    try {
      const raw = await readJson<RawSeries>(`${dir}/${file}`);
      const analyzedSeries = analyzeSeries(raw)(cfg);

      if (analyzedSeries.bars.length === 0) {
        continue;
      }

      await writeAnalyzedSeries(date, analyzedSeries);
      const lastBar = analyzedSeries.bars[analyzedSeries.bars.length - 1];
      const summary: AnalysisIntervalSummary = {
        analyzedAt: analyzedSeries.analyzedAt,
        barCount: analyzedSeries.bars.length,
        lastBarTime: lastBar?.t ?? null,
        lastClose: typeof lastBar?.c === "number" && Number.isFinite(lastBar.c) ? lastBar.c : null,
        activeSignals: analyzedSeries.signals.filter((s) => s.active).map((s) => s.label)
      };
      series[analyzedSeries.symbol] ||= {};
      series[analyzedSeries.symbol][analyzedSeries.interval] = summary;
      analyzed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[market:analyze] Failed processing ${file}: ${message}`);
    }
  }

  if (Object.keys(series).length === 0) {
    throw new Error(`[market:analyze] No series analyzed for ${date}`);
  }

  const summary: MarketAnalysisSummary = {
    schemaVersion: 1,
    date,
    generatedAt: new Date().toISOString(),
    symbols: universeSymbols,
    intervals,
    missingSymbols: universeSymbols.filter((s) => !(s in series)),
    series
  };
  const mdx = buildAnalysisMdx(summary);
  await writeAnalysisPage(date, summary, mdx);

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
    intervals: data.intervals
  });

  return {
    wroteData: data.written,
    analyzed: analysis.analyzed,
    wroteReport: report.wrote,
    missingSymbols: data.missingSymbols
  };
}
