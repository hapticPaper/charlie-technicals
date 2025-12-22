import type {
  AnalyzedSeries,
  MarketInterval,
  MarketReport,
  ReportIntervalSeries
} from "./types";

function activeSignals(series: ReportIntervalSeries): string[] {
  return series.signals.filter((s) => s.active).map((s) => s.label);
}

function toNullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toReportSeries(analyzed: AnalyzedSeries, maxPoints: number): ReportIntervalSeries {
  const sma20 = Array.isArray(analyzed.indicators.sma20) ? analyzed.indicators.sma20 : undefined;
  const ema20 = Array.isArray(analyzed.indicators.ema20) ? analyzed.indicators.ema20 : undefined;
  const rsi14 = Array.isArray(analyzed.indicators.rsi14) ? analyzed.indicators.rsi14 : undefined;

  const bars = analyzed.bars;
  const startIndex = Math.max(0, bars.length - maxPoints);
  const slicedBars = bars.slice(startIndex);

  const t = slicedBars.map((b) => Math.floor(new Date(b.t).getTime() / 1000));
  const close = slicedBars.map((b) => b.c);
  const sma = slicedBars.map((_, idx) => {
    const i = startIndex + idx;
    return sma20 ? toNullableNumber(sma20[i]) : null;
  });
  const ema = slicedBars.map((_, idx) => {
    const i = startIndex + idx;
    return ema20 ? toNullableNumber(ema20[i]) : null;
  });
  const rsi = slicedBars.map((_, idx) => {
    const i = startIndex + idx;
    return rsi14 ? toNullableNumber(rsi14[i]) : null;
  });

  return {
    symbol: analyzed.symbol,
    interval: analyzed.interval,
    t,
    close,
    sma20: sma,
    ema20: ema,
    rsi14: rsi,
    signals: analyzed.signals
  };
}

function buildSummaries(
  date: string,
  seriesBySymbol: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>>,
  missingSymbols: string[]
): MarketReport["summaries"] {
  function capWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      return text;
    }

    return `${words.slice(0, maxWords).join(" ")} …`;
  }

  const lines: string[] = [];

  for (const symbol of Object.keys(seriesBySymbol).sort()) {
    const intervals = seriesBySymbol[symbol];
    const hits: string[] = [];
    for (const maybeSeries of Object.values(intervals)) {
      if (maybeSeries) {
        hits.push(...activeSignals(maybeSeries));
      }
    }
    const unique = Array.from(new Set(hits));
    if (unique.length > 0) {
      lines.push(`${symbol}: ${unique.slice(0, 2).join("; ")}`);
    }
  }

  const veryShort = capWords(
    lines.length === 0
      ? "No major technical signals triggered in the configured rules." +
          (missingSymbols.length > 0 ? " (Some symbols missing.)" : "")
      : lines.slice(0, 3).join(" | ") + (lines.length > 3 ? " | …" : ""),
    30
  );

  const mainIdeaParts: string[] = [];
  if (lines.length === 0) {
    mainIdeaParts.push(
      "Across the configured universe, the ruleset did not flag an overbought/oversold RSI or a MACD cross on the latest bar."
    );
  } else {
    mainIdeaParts.push(
      `The ruleset flagged actionable signals in ${lines.length} symbol${lines.length === 1 ? "" : "s"} on the latest bar.`
    );
  }
  if (missingSymbols.length > 0) {
    mainIdeaParts.push(`Missing symbols from provider: ${missingSymbols.join(", ")}.`);
  }

  const summaryParts: string[] = [];
  summaryParts.push(`Report date: ${date}.`);
  if (lines.length > 0) {
    summaryParts.push("Top hits:");
    for (const l of lines.slice(0, 8)) {
      summaryParts.push(`- ${l}`);
    }
  } else {
    summaryParts.push("No active signals were detected on the latest bar. Use the charts below to sanity-check the context.");
  }
  if (missingSymbols.length > 0) {
    summaryParts.push(`Symbols skipped due to missing data: ${missingSymbols.join(", ")}.`);
  }

  const rawSummary = summaryParts.join("\n");

  return {
    veryShort,
    mainIdea: capWords(mainIdeaParts.join(" ").trim(), 80),
    // 500-word cap per requirements.
    summary: capWords(rawSummary, 500)
  };
}

export function buildMarketReport(args: {
  date: string;
  symbols: string[];
  intervals: MarketInterval[];
  analyzed: AnalyzedSeries[];
  missingSymbols: string[];
}): MarketReport {
  const seriesBySymbol: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>> = {};
  for (const s of args.analyzed) {
    seriesBySymbol[s.symbol] ||= {};
    seriesBySymbol[s.symbol][s.interval] = toReportSeries(s, 220);
  }

  const summaries = buildSummaries(args.date, seriesBySymbol, args.missingSymbols);

  return {
    date: args.date,
    generatedAt: new Date().toISOString(),
    symbols: args.symbols,
    intervals: args.intervals,
    missingSymbols: args.missingSymbols,
    series: seriesBySymbol,
    summaries
  };
}

export function buildReportMdx(report: MarketReport): string {
  const symbols = Object.keys(report.series).sort();
  const intervals = report.intervals;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: "Market Report: ${report.date}"`);
  lines.push(`date: ${report.date}`);
  lines.push(`generatedAt: ${report.generatedAt}`);
  lines.push("---");
  lines.push("");
  lines.push("<ReportSummary />");
  lines.push("");
  lines.push("## Universe");
  lines.push("");
  lines.push(`Symbols: ${report.symbols.join(", ")}`);
  lines.push("");
  lines.push(`Intervals: ${intervals.join(", ")}`);
  lines.push("");

  if (report.missingSymbols.length > 0) {
    lines.push(`Missing symbols: ${report.missingSymbols.join(", ")}`);
    lines.push("");
  }

  for (const symbol of symbols) {
    lines.push(`## ${symbol}`);
    lines.push("");

    for (const interval of intervals) {
      lines.push(`### ${interval}`);
      lines.push("");
      lines.push(`<ReportCharts symbol="${symbol}" interval="${interval}" />`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}
