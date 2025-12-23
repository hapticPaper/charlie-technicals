import type {
  AnalyzedSeries,
  BollingerBandsSeries,
  KeltnerChannelsSeries,
  MarketInterval,
  MarketReport,
  ReportPick,
  ReportIntervalSeries,
  SqueezeState,
  TtmSqueezeSeries
} from "./types";

import { SQUEEZE_STATES } from "./types";

import type { TradePlan, TradeSide } from "./types";

function activeSignals(series: ReportIntervalSeries): string[] {
  return series.signals.filter((s) => s.active).map((s) => s.label);
}

function activeSignalLabels(series: AnalyzedSeries): string[] {
  return series.signals.filter((s) => s.active).map((s) => s.label);
}

function getSignalActive(series: AnalyzedSeries, id: string): boolean {
  return series.signals.some((s) => s.id === id && s.active);
}

function inferTradeSideFromSignals(series: AnalyzedSeries): TradeSide | null {
  if (getSignalActive(series, "macd-bull-cross")) {
    return "buy";
  }
  if (getSignalActive(series, "macd-bear-cross")) {
    return "sell";
  }
  if (getSignalActive(series, "rsi-oversold")) {
    return "buy";
  }
  if (getSignalActive(series, "rsi-overbought")) {
    return "sell";
  }

  return null;
}

function lastFiniteNumber(values: Array<number | null> | undefined, index: number): number | null {
  const v = values?.[index];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function inferTradeSideFromTrend(series: AnalyzedSeries): TradeSide | null {
  const idx = series.bars.length - 1;
  if (idx < 0) {
    return null;
  }

  const close = series.bars[idx]?.c;
  const ema20 = Array.isArray(series.indicators.ema20)
    ? lastFiniteNumber(series.indicators.ema20, idx)
    : null;
  const sma20 = Array.isArray(series.indicators.sma20)
    ? lastFiniteNumber(series.indicators.sma20, idx)
    : null;

  if (typeof close !== "number" || ema20 === null || sma20 === null) {
    return null;
  }

  if (close > ema20 && ema20 > sma20) {
    return "buy";
  }

  if (close < ema20 && ema20 < sma20) {
    return "sell";
  }

  return null;
}

function clampToValidStop(entry: number, side: TradeSide, stop: number): number {
  const fallbackPct = 0.015;
  if (side === "buy") {
    if (!(stop < entry)) {
      return entry * (1 - fallbackPct);
    }

    const riskPct = (entry - stop) / entry;
    if (riskPct < 0.002) {
      return entry * (1 - fallbackPct);
    }
    return stop;
  }

  if (!(stop > entry)) {
    return entry * (1 + fallbackPct);
  }

  const riskPct = (stop - entry) / entry;
  if (riskPct < 0.002) {
    return entry * (1 + fallbackPct);
  }
  return stop;
}

function buildTradePlan(series15m: AnalyzedSeries, side: TradeSide): TradePlan {
  const last = series15m.bars.at(-1);
  if (!last) {
    throw new Error(`Missing bars for ${series15m.symbol} 15m`);
  }

  const entry = last.c;
  if (!Number.isFinite(entry)) {
    throw new Error(`Invalid entry price for ${series15m.symbol} 15m`);
  }

  const recent = series15m.bars.slice(-20);
  if (recent.length === 0) {
    throw new Error(`Insufficient bars for ${series15m.symbol} 15m`);
  }

  const lows = recent.map((b) => b.l).filter((v) => Number.isFinite(v));
  const highs = recent.map((b) => b.h).filter((v) => Number.isFinite(v));
  if (lows.length === 0 || highs.length === 0) {
    throw new Error(`Invalid highs/lows for ${series15m.symbol} 15m`);
  }

  const buffer = entry * 0.001;

  let stop: number;
  if (side === "buy") {
    stop = Math.min(...lows) - buffer;
  } else {
    stop = Math.max(...highs) + buffer;
  }

  stop = clampToValidStop(entry, side, stop);
  const risk = Math.abs(entry - stop);
  const dir = side === "buy" ? 1 : -1;
  const targets = [entry + dir * risk * 2, entry + dir * risk * 3];

  return { side, entry, stop, targets };
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toReportSeries(analyzed: AnalyzedSeries, maxPoints: number): ReportIntervalSeries {
  const bars = analyzed.bars;
  const startIndex = Math.max(0, bars.length - maxPoints);
  const slicedBars = bars.slice(startIndex);
  const sliceLength = slicedBars.length;

  const warnPrefix = `[report] ${analyzed.symbol}/${analyzed.interval}`;

  function warn(message: string): void {
    console.warn(`${warnPrefix} ${message}`);
  }

  function sliceNullableNumberSeries(value: unknown, context: string): Array<number | null> {
    const fallback = new Array(sliceLength).fill(null);

    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return fallback;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return fallback;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v !== "number") {
        invalidCount += 1;
        return null;
      }

      return toNullableNumber(v);
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-number items to null`);
    }

    return out;
  }

  function sliceStrictNullableNumberSeries(
    value: unknown,
    context: string
  ): Array<number | null> | undefined {
    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return undefined;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return undefined;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v !== "number") {
        invalidCount += 1;
        return null;
      }

      return toNullableNumber(v);
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-number items to null`);
    }

    return out;
  }

  function sliceStrictNullableBoolSeries(
    value: unknown,
    context: string
  ): Array<boolean | null> | undefined {
    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return undefined;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return undefined;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v !== "boolean") {
        invalidCount += 1;
        return null;
      }

      return toNullableBoolean(v);
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-boolean items to null`);
    }

    return out;
  }

  function sliceStrictNullableSqueezeStateSeries(
    value: unknown,
    context: string
  ): Array<SqueezeState | null> | undefined {
    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return undefined;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return undefined;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v === "string" && (SQUEEZE_STATES as readonly string[]).includes(v)) {
        return v as SqueezeState;
      }

      invalidCount += 1;
      return null;
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-state items to null`);
    }

    return out;
  }

  type ChannelSeries = { middle: Array<number | null>; upper: Array<number | null>; lower: Array<number | null> };

  function sliceChannelSeries(value: unknown, context: string): ChannelSeries | undefined {
    if (!isRecord(value)) {
      warn(`Invalid ${context} series: expected object`);
      return undefined;
    }

    const middle = sliceStrictNullableNumberSeries(value.middle, `${context}.middle`);
    const upper = sliceStrictNullableNumberSeries(value.upper, `${context}.upper`);
    const lower = sliceStrictNullableNumberSeries(value.lower, `${context}.lower`);
    if (!middle || !upper || !lower) {
      return undefined;
    }

    return {
      middle,
      upper,
      lower
    };
  }

  function sliceTtmSqueezeSeries(value: unknown, context: string): TtmSqueezeSeries | undefined {
    if (!isRecord(value)) {
      warn(`Invalid ${context} series: expected object`);
      return undefined;
    }

    const bollinger = sliceChannelSeries(value.bollinger, `${context}.bollinger`);
    const keltner = sliceChannelSeries(value.keltner, `${context}.keltner`);
    if (!bollinger || !keltner) {
      return undefined;
    }

    const squeezeOn = sliceStrictNullableBoolSeries(value.squeezeOn, `${context}.squeezeOn`);
    const squeezeOff = sliceStrictNullableBoolSeries(value.squeezeOff, `${context}.squeezeOff`);
    const momentum = sliceStrictNullableNumberSeries(value.momentum, `${context}.momentum`);
    if (!squeezeOn || !squeezeOff || !momentum) {
      return undefined;
    }

    const derivedSqueezeState = squeezeOn.map((on, idx) => {
      const off = squeezeOff[idx];
      if (on === null || off === null) {
        return null;
      }
      return on ? "on" : off ? "off" : "neutral";
    });

    const squeezeState =
      value.squeezeState === undefined
        ? derivedSqueezeState
        : sliceStrictNullableSqueezeStateSeries(value.squeezeState, `${context}.squeezeState`) ?? derivedSqueezeState;

    const hasMomentum = momentum.some((v) => v !== null);
    const hasSqueezeFlag = squeezeOn.some((v) => v !== null) || squeezeOff.some((v) => v !== null);
    if (!hasMomentum && !hasSqueezeFlag) {
      return undefined;
    }

    return {
      bollinger,
      keltner,
      squeezeOn,
      squeezeOff,
      squeezeState,
      momentum
    };
  }

  const sma =
    analyzed.indicators.sma20 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.sma20, "sma20");
  const ema =
    analyzed.indicators.ema20 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.ema20, "ema20");
  const rsi =
    analyzed.indicators.rsi14 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.rsi14, "rsi14");
  const atr =
    analyzed.indicators.atr14 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.atr14, "atr14");

  const bollingerOut =
    analyzed.indicators.bollinger20 === undefined
      ? undefined
      : (sliceChannelSeries(analyzed.indicators.bollinger20, "bollinger20") as
          | BollingerBandsSeries
          | undefined);
  const keltnerOut =
    analyzed.indicators.keltner20 === undefined
      ? undefined
      : (sliceChannelSeries(analyzed.indicators.keltner20, "keltner20") as
          | KeltnerChannelsSeries
          | undefined);
  const ttmOut =
    analyzed.indicators.ttmSqueeze20 === undefined
      ? undefined
      : sliceTtmSqueezeSeries(analyzed.indicators.ttmSqueeze20, "ttmSqueeze20");

  const t = slicedBars.map((b) => Math.floor(new Date(b.t).getTime() / 1000));
  const close = slicedBars.map((b) => b.c);
  const high = slicedBars.map((b) => b.h);
  const low = slicedBars.map((b) => b.l);

  return {
    symbol: analyzed.symbol,
    interval: analyzed.interval,
    t,
    close,
    high,
    low,
    sma20: sma,
    ema20: ema,
    rsi14: rsi,
    atr14: atr,
    bollinger20: bollingerOut,
    keltner20: keltnerOut,
    ttmSqueeze20: ttmOut,
    signals: analyzed.signals
  };
}

function buildPicks(args: {
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>;
}): ReportPick[] {
  const candidates: ReportPick[] = [];

  for (const symbol of Object.keys(args.analyzedBySymbol)) {
    const series15m = args.analyzedBySymbol[symbol]?.["15m"];
    const series1d = args.analyzedBySymbol[symbol]?.["1d"];
    if (!series15m || !series1d) {
      continue;
    }

    const side15 = inferTradeSideFromSignals(series15m);
    const side1d = inferTradeSideFromSignals(series1d);
    const sideTrend1d = inferTradeSideFromTrend(series1d);
    const sideTrend15 = inferTradeSideFromTrend(series15m);

    const side = side15 ?? side1d ?? sideTrend15 ?? sideTrend1d;
    if (!side) {
      continue;
    }

    const signals15 = activeSignalLabels(series15m);
    const signals1d = activeSignalLabels(series1d);

    const close15 = series15m.bars.at(-1)?.c;
    const ema15 = Array.isArray(series15m.indicators.ema20)
      ? lastFiniteNumber(series15m.indicators.ema20, series15m.bars.length - 1)
      : null;
    const rsi15 = Array.isArray(series15m.indicators.rsi14)
      ? lastFiniteNumber(series15m.indicators.rsi14, series15m.bars.length - 1)
      : null;

    const trendStrength =
      typeof close15 === "number" && ema15 !== null && close15 !== 0
        ? Math.min(0.06, Math.abs((close15 - ema15) / close15))
        : 0;

    let score = 0;
    score += signals15.length * 3;
    score += signals1d.length * 2;
    if (side15 && side1d && side15 === side1d) {
      score += 4;
    }
    if (sideTrend1d === side) {
      score += 1;
    }
    if (sideTrend15 === side) {
      score += 1;
    }
    if (sideTrend1d && sideTrend15 && sideTrend1d === sideTrend15) {
      score += 1;
    }
    score += Math.round(trendStrength * 1000);
    if (rsi15 !== null) {
      score += Math.round(Math.min(10, Math.abs(rsi15 - 50) / 5));
    }

    const rationale: string[] = [];
    if (signals1d.length > 0) {
      rationale.push(`1d signals: ${signals1d.slice(0, 3).join("; ")}`);
    }
    if (signals15.length > 0) {
      rationale.push(`15m signals: ${signals15.slice(0, 3).join("; ")}`);
    }
    if (sideTrend1d) {
      rationale.push(`1d trend bias: ${sideTrend1d === "buy" ? "bullish" : "bearish"}`);
    }
    if (rationale.length === 0) {
      rationale.push("Trend continuation setup (no explicit rule hit on the latest bar).");
    }

    candidates.push({
      symbol,
      score,
      trade: buildTradePlan(series15m, side),
      rationale,
      signals: {
        "15m": signals15,
        "1d": signals1d
      }
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return candidates.slice(0, 5);
}

function buildSummaries(
  date: string,
  picks: ReportPick[],
  seriesBySymbol: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>>,
  missingSymbols: string[]
): MarketReport["summaries"] {
  function formatList(values: string[], max: number): string {
    if (values.length <= max) {
      return values.join(", ");
    }

    return `${values.slice(0, max).join(", ")}, …`;
  }

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
    picks.length === 0
      ? lines.length === 0
          ? "No major technical signals triggered in the configured rules." +
              (missingSymbols.length > 0 ? " (Some symbols missing.)" : "")
          : lines.slice(0, 3).join(" | ") + (lines.length > 3 ? " | …" : "")
      : picks
          .slice(0, 3)
          .map((p) => `${p.symbol}: ${p.trade.side.toUpperCase()} (stop ${p.trade.stop.toFixed(2)})`)
          .join(" | ") + (picks.length > 3 ? " | …" : ""),
    30
  );

  const mainIdeaParts: string[] = [];
  if (picks.length === 0 && lines.length === 0) {
    mainIdeaParts.push(
      "Across the configured universe, the ruleset did not flag an overbought/oversold RSI or a MACD cross on the latest bar."
    );
  } else if (picks.length > 0) {
    mainIdeaParts.push(
      `Top setups today: ${picks
        .slice(0, 5)
        .map((p) => `${p.symbol} ${p.trade.side}`)
        .join(", ")}.`
    );
  } else {
    mainIdeaParts.push(
      `The ruleset flagged actionable signals in ${lines.length} symbol${lines.length === 1 ? "" : "s"} on the latest bar.`
    );
  }
  if (missingSymbols.length > 0) {
    mainIdeaParts.push(`Missing symbols from provider (${missingSymbols.length}): ${formatList(missingSymbols, 8)}.`);
  }

  const summaryParts: string[] = [];
  summaryParts.push(`Report date: ${date}.`);
  if (picks.length > 0) {
    summaryParts.push("Top setups:");
    for (const p of picks) {
      summaryParts.push(
        `- ${p.symbol}: ${p.trade.side.toUpperCase()} entry ${p.trade.entry.toFixed(2)}, stop ${p.trade.stop.toFixed(2)}`
      );
    }
  } else if (lines.length > 0) {
    summaryParts.push("Top hits:");
    for (const l of lines.slice(0, 8)) {
      summaryParts.push(`- ${l}`);
    }
  } else {
    summaryParts.push("No active signals were detected on the latest bar. Use the charts below to sanity-check the context.");
  }
  if (missingSymbols.length > 0) {
    summaryParts.push(
      `Symbols skipped due to missing data (${missingSymbols.length}): ${formatList(missingSymbols, 12)}.`
    );
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
  const analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>> = {};
  for (const s of args.analyzed) {
    seriesBySymbol[s.symbol] ||= {};
    seriesBySymbol[s.symbol][s.interval] = toReportSeries(s, 220);

    analyzedBySymbol[s.symbol] ||= {};
    analyzedBySymbol[s.symbol][s.interval] = s;
  }

  const picks = buildPicks({ analyzedBySymbol });
  const summaries = buildSummaries(args.date, picks, seriesBySymbol, args.missingSymbols);

  return {
    date: args.date,
    generatedAt: new Date().toISOString(),
    symbols: args.symbols,
    intervals: args.intervals,
    missingSymbols: args.missingSymbols,
    picks,
    series: seriesBySymbol,
    summaries
  };
}

function formatFrontmatterString(value: string): string {
  // Centralized frontmatter escaping; currently uses JSON-style quoting.
  return JSON.stringify(value);
}

export function buildReportMdx(report: MarketReport): string {
  // Builds a lean MDX report focused on highlights and actionable picks.
  // Picks render their own charts/indicator overlays; full universe/interval metadata and chart data are
  // also available in the JSON report.
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${formatFrontmatterString(`Market Report: ${report.date}`)}`);
  lines.push(`date: ${formatFrontmatterString(report.date)}`);
  lines.push(`generatedAt: ${formatFrontmatterString(report.generatedAt)}`);
  lines.push(`version: ${formatFrontmatterString("v2-highlights")}`);
  lines.push("---");
  lines.push("");
  lines.push("<ReportSummary />");
  lines.push("");
  lines.push(`<CnbcVideoWidget date="${report.date}" />`);
  lines.push("");

  lines.push("## Today's top setups");
  lines.push("");
  if (report.picks.length === 0) {
    lines.push("No clear trade setups today based on the configured rules.");
    lines.push("");
  } else {
    for (const pick of report.picks) {
      lines.push(`### ${pick.symbol}`);
      lines.push("");
      lines.push(`<ReportPick symbol="${pick.symbol}" />`);
      lines.push("");
    }
  }

  lines.push("## Universe");
  lines.push("");
  lines.push("(Universe details live in the JSON report.)");
  lines.push("");
  lines.push("## Charts");
  lines.push("");
  lines.push("(Charts are rendered per-pick above; full series live in the JSON report.)");
  lines.push("");

  return `${lines.join("\n")}\n`;
}
