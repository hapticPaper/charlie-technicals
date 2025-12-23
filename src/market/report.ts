import type {
  AnalyzedSeries,
  BollingerBandsSeries,
  KeltnerChannelsSeries,
  MarketBar,
  MarketInterval,
  MarketReport,
  MostActiveEntry,
  ReportPick,
  ReportIntervalSeries,
  SqueezeState,
  TtmSqueezeSeries
} from "./types";

import { REPORT_MAX_PICKS, REPORT_MAX_WATCHLIST, REPORT_VERY_SHORT_MAX_WORDS, SQUEEZE_STATES } from "./types";

import type { TradePlan, TradeSide } from "./types";

function activeSignals(series: ReportIntervalSeries): string[] {
  return series.signals.filter((s) => s.active).map((s) => s.label);
}

function activeSignalLabels(series: AnalyzedSeries): string[] {
  return series.signals.filter((s) => s.active).map((s) => s.label);
}

function lastFiniteNumber(values: Array<number | null> | undefined, index: number): number | null {
  const v = values?.[index];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function computeMoveAtr1d(series1d: AnalyzedSeries): {
  atr14: number | null;
  move1d: number | null;
  move1dAtr14: number | null;
  absMove1dAtr14: number | null;
} {
  const idx1d = series1d.bars.length - 1;
  const atr14 = Array.isArray(series1d.indicators.atr14) ? lastFiniteNumber(series1d.indicators.atr14, idx1d) : null;

  const last = series1d.bars.at(-1);
  const prev = series1d.bars.at(-2);
  const move1d = last && prev && Number.isFinite(last.c) && Number.isFinite(prev.c) ? last.c - prev.c : null;

  const move1dAtr14 = atr14 !== null && move1d !== null && atr14 !== 0 ? move1d / atr14 : null;
  const absMove1dAtr14 = move1dAtr14 !== null ? Math.abs(move1dAtr14) : null;

  return { atr14, move1d, move1dAtr14, absMove1dAtr14 };
}

function computeRocPct(bars: MarketBar[], lookback: number): number | null {
  const smooth = 3;
  if (lookback <= 0) {
    return null;
  }

  const idx = bars.length - 1;
  const prevIdx = idx - lookback;
  const recentStart = idx - (smooth - 1);
  const prevStart = prevIdx - (smooth - 1);
  if (prevStart < 0 || recentStart < 0) {
    return null;
  }

  const recentCloses = bars.slice(recentStart, idx + 1).map((b) => b.c).filter((v) => Number.isFinite(v));
  const prevCloses = bars.slice(prevStart, prevIdx + 1).map((b) => b.c).filter((v) => Number.isFinite(v));
  if (recentCloses.length < smooth || prevCloses.length < smooth) {
    return null;
  }

  const avgRecent = recentCloses.reduce((sum, v) => sum + v, 0) / recentCloses.length;
  const avgPrev = prevCloses.reduce((sum, v) => sum + v, 0) / prevCloses.length;
  if (!(Number.isFinite(avgRecent) && Number.isFinite(avgPrev) && avgPrev !== 0)) {
    return null;
  }

  const roc = (avgRecent - avgPrev) / avgPrev;
  return Number.isFinite(roc) ? roc : null;
}

function sign(value: number): -1 | 0 | 1 {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}

type BreakoutHit =
  | {
      direction: "up" | "down";
      window: 20 | 55 | 252;
      level: number;
    }
  | null;

function previousHighLow(bars: MarketBar[], lookback: number): { high: number; low: number } | null {
  const end = bars.length - 1;
  const start = end - lookback;
  if (start < 0 || end <= 0) {
    return null;
  }

  const window = bars.slice(start, end);
  if (window.length === 0) {
    return null;
  }

  const highs = window.map((b) => b.h).filter((v) => Number.isFinite(v));
  const lows = window.map((b) => b.l).filter((v) => Number.isFinite(v));
  if (highs.length === 0 || lows.length === 0) {
    return null;
  }

  return {
    high: Math.max(...highs),
    low: Math.min(...lows)
  };
}

function detectDailyBreakout(series1d: AnalyzedSeries): BreakoutHit {
  const last = series1d.bars.at(-1);
  if (!last || !Number.isFinite(last.c)) {
    return null;
  }

  const close = last.c;
  const windows = [252, 55, 20] as const;
  for (const w of windows) {
    const hl = previousHighLow(series1d.bars, w);
    if (!hl) {
      continue;
    }

    if (close > hl.high) {
      return { direction: "up", window: w, level: hl.high };
    }
    if (close < hl.low) {
      return { direction: "down", window: w, level: hl.low };
    }
  }

  return null;
}

function computePivotLevels(bars: MarketBar[], maxBars: number): { support: number | null; resistance: number | null } {
  const last = bars.at(-1);
  if (!last || !Number.isFinite(last.c)) {
    return { support: null, resistance: null };
  }

  const close = last.c;
  const windowBars = bars.slice(-Math.max(maxBars, 10));
  const leftRight = 2;

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  for (let i = leftRight; i < windowBars.length - leftRight; i += 1) {
    const center = windowBars[i];
    if (!center) {
      continue;
    }

    const ch = center.h;
    const cl = center.l;
    if (!(Number.isFinite(ch) && Number.isFinite(cl))) {
      continue;
    }

    let isPivotHigh = true;
    let isPivotLow = true;
    for (let j = 1; j <= leftRight; j += 1) {
      const left = windowBars[i - j];
      const right = windowBars[i + j];
      if (!left || !right) {
        isPivotHigh = false;
        isPivotLow = false;
        break;
      }

      if (!(Number.isFinite(left.h) && Number.isFinite(right.h) && Number.isFinite(left.l) && Number.isFinite(right.l))) {
        isPivotHigh = false;
        isPivotLow = false;
        break;
      }

      if (ch <= left.h || ch <= right.h) {
        isPivotHigh = false;
      }
      if (cl >= left.l || cl >= right.l) {
        isPivotLow = false;
      }
    }

    if (isPivotHigh) {
      pivotHighs.push(ch);
    }
    if (isPivotLow) {
      pivotLows.push(cl);
    }
  }

  const supportCandidates = pivotLows.filter((p) => p < close);
  const resistanceCandidates = pivotHighs.filter((p) => p > close);

  const support = supportCandidates.length > 0 ? Math.max(...supportCandidates) : null;
  const resistance = resistanceCandidates.length > 0 ? Math.min(...resistanceCandidates) : null;
  return { support, resistance };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function computeParticipation1d(series1d: AnalyzedSeries, atr1d: number | null): {
  rangeAtr: number | null;
  volumeMultiple20: number | null;
  direction: "up" | "down" | null;
} {
  const last = series1d.bars.at(-1);
  const prev = series1d.bars.at(-2);
  if (!last || !prev) {
    return { rangeAtr: null, volumeMultiple20: null, direction: null };
  }

  const range = Number.isFinite(last.h) && Number.isFinite(last.l) ? last.h - last.l : null;
  const rangeAtr =
    range !== null && typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0 ? range / atr1d : null;

  const prevBars = series1d.bars.slice(-21, -1);
  const volAvg = average(prevBars.map((b) => b.v).filter((v) => Number.isFinite(v)));
  const volumeMultiple20 =
    volAvg !== null && Number.isFinite(last.v) && volAvg > 0 ? last.v / volAvg : null;

  const direction =
    Number.isFinite(last.c) && Number.isFinite(prev.c)
      ? last.c > prev.c
        ? "up"
        : last.c < prev.c
          ? "down"
          : null
      : null;

  return { rangeAtr, volumeMultiple20, direction };
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

function buildTradePlan(series15m: AnalyzedSeries, side: TradeSide, atr1d: number | null): TradePlan {
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

  const atrMove1 = typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0 ? atr1d * 2 : null;
  const atrMove2 = typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0 ? atr1d * 3 : null;
  const move1 = Math.max(risk * 2, atrMove1 ?? 0);
  const move2 = Math.max(risk * 3, atrMove2 ?? 0);
  const targets = [entry + dir * move1, entry + dir * move2];

  return { side, entry, stop, targets };
}

function safeDollarVolume(bar: { c: number; v: number } | undefined): number | null {
  if (!bar) {
    return null;
  }

  if (!(Number.isFinite(bar.c) && Number.isFinite(bar.v))) {
    return null;
  }

  const dv = bar.c * bar.v;
  return Number.isFinite(dv) ? dv : null;
}

function buildMostActive(args: {
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>;
}): MarketReport["mostActive"] {
  const entries: MostActiveEntry[] = [];

  for (const symbol of Object.keys(args.analyzedBySymbol)) {
    const series1d = args.analyzedBySymbol[symbol]?.["1d"];
    if (!series1d) {
      continue;
    }

    const last = series1d.bars.at(-1);
    const prev = series1d.bars.at(-2);
    if (!last || !Number.isFinite(last.c)) {
      continue;
    }

    const dollarVolume1d = safeDollarVolume(last);
    if (dollarVolume1d === null) {
      continue;
    }

    const weekBars = series1d.bars.slice(-5);
    const dvWeek = weekBars.map((b) => safeDollarVolume(b)).filter((v): v is number => typeof v === "number");
    if (dvWeek.length < 3) {
      continue;
    }
    const dollarVolume5d = dvWeek.reduce((sum, v) => sum + v, 0);

    const idx = series1d.bars.length - 1;
    const atr14 = Array.isArray(series1d.indicators.atr14)
      ? lastFiniteNumber(series1d.indicators.atr14, idx)
      : null;

    const change1d = prev && Number.isFinite(prev.c) ? last.c - prev.c : null;
    const change1dPct =
      change1d !== null && prev && Number.isFinite(prev.c) && prev.c !== 0 ? change1d / prev.c : null;
    const change1dAtr14 = atr14 !== null && change1d !== null && atr14 !== 0 ? change1d / atr14 : null;

    entries.push({
      symbol,
      dollarVolume1d,
      dollarVolume5d,
      close: last.c,
      change1d,
      change1dPct,
      atr14,
      change1dAtr14,
      trendBias1d: inferTradeSideFromTrend(series1d),
      signals1d: activeSignalLabels(series1d)
    });
  }

  if (entries.length === 0) {
    return undefined;
  }

  const byDollarVolume1d = entries
    .slice()
    .sort((a, b) => b.dollarVolume1d - a.dollarVolume1d || a.symbol.localeCompare(b.symbol))
    .slice(0, 12);

  const byDollarVolume5d = entries
    .slice()
    .sort((a, b) => b.dollarVolume5d - a.dollarVolume5d || a.symbol.localeCompare(b.symbol))
    .slice(0, 12);

  return { byDollarVolume1d, byDollarVolume5d };
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
}): { picks: ReportPick[]; watchlist: ReportPick[] } {
  // Policy:
  // - Technical trades: should be driven by an explicit setup (momentum alignment, breakouts, or levels) and
  //   ideally have a >= 1 ATR daily move when ATR is available.
  // - Watchlist: trend-following setups, or explicit setups that are still sub-ATR on the day.
  const MIN_TRADE_ABS_MOVE_ATR = 1;
  const MOMENTUM_LOOKBACK = {
    "15m": 20,
    "1h": 20,
    "1d": 20
  } as const;

  const LEVEL_LOOKBACK_1D = 90;
  const NEAR_LEVEL_MAX_ATR = 0.35;
  const PARTICIPATION_MIN_RANGE_ATR = 1;
  const PARTICIPATION_MIN_VOL_MULT = 1.3;

  type Candidate = ReportPick & {
    absMove1dAtr14: number | null;
    breakout: BreakoutHit;
    hasParticipation: boolean;
  };

  const candidates: Candidate[] = [];

  for (const symbol of Object.keys(args.analyzedBySymbol)) {
    const series15m = args.analyzedBySymbol[symbol]?.["15m"];
    const series1h = args.analyzedBySymbol[symbol]?.["1h"];
    const series1d = args.analyzedBySymbol[symbol]?.["1d"];
    if (!series15m || !series1d) {
      continue;
    }

    const breakout = detectDailyBreakout(series1d);

    const roc15 = computeRocPct(series15m.bars, MOMENTUM_LOOKBACK["15m"]);
    const roc1h = series1h ? computeRocPct(series1h.bars, MOMENTUM_LOOKBACK["1h"]) : null;
    const roc1d = computeRocPct(series1d.bars, MOMENTUM_LOOKBACK["1d"]);

    const rocValues = [roc15, roc1h, roc1d].filter((v): v is number => typeof v === "number");
    const rocSigns = rocValues.map(sign).filter((s): s is -1 | 1 => s !== 0);
    const momentumAligned = rocSigns.length >= 2 && rocSigns.every((s) => s === rocSigns[0]);
    const momentumSide: TradeSide | null = momentumAligned ? (rocSigns[0] === 1 ? "buy" : "sell") : null;

    const strongDailyMomentumSide: TradeSide | null =
      typeof roc1d === "number" && Math.abs(roc1d) >= 0.03 ? (roc1d > 0 ? "buy" : roc1d < 0 ? "sell" : null) : null;

    const breakoutSide: TradeSide | null = breakout ? (breakout.direction === "up" ? "buy" : "sell") : null;

    const sideTrend15 = inferTradeSideFromTrend(series15m);
    const sideTrend1h = series1h ? inferTradeSideFromTrend(series1h) : null;
    const sideTrend1d = inferTradeSideFromTrend(series1d);

    const side = breakoutSide ?? momentumSide ?? strongDailyMomentumSide ?? sideTrend1d ?? sideTrend1h ?? sideTrend15;
    if (!side) {
      continue;
    }

    const signals15 = activeSignalLabels(series15m);
    const signals1h = series1h ? activeSignalLabels(series1h) : [];
    const signals1d = activeSignalLabels(series1d);

    const moveInfo = computeMoveAtr1d(series1d);
    const atr1d = moveInfo.atr14;
    const move1d = moveInfo.move1d;
    const move1dAtr14 = moveInfo.move1dAtr14;
    const absMove1dAtr14 = moveInfo.absMove1dAtr14;

    const levels = computePivotLevels(series1d.bars, LEVEL_LOOKBACK_1D);
    const close1d = series1d.bars.at(-1)?.c;
    const supportDistAtr =
      typeof close1d === "number" && typeof levels.support === "number" && typeof atr1d === "number" && atr1d > 0
        ? (close1d - levels.support) / atr1d
        : null;
    const resistanceDistAtr =
      typeof close1d === "number" && typeof levels.resistance === "number" && typeof atr1d === "number" && atr1d > 0
        ? (levels.resistance - close1d) / atr1d
        : null;

    const nearSupport =
      typeof supportDistAtr === "number" && supportDistAtr >= 0 && supportDistAtr <= NEAR_LEVEL_MAX_ATR;
    const nearResistance =
      typeof resistanceDistAtr === "number" && resistanceDistAtr >= 0 && resistanceDistAtr <= NEAR_LEVEL_MAX_ATR;

    const participation = computeParticipation1d(series1d, atr1d);
    const hasParticipation =
      typeof participation.rangeAtr === "number" &&
      participation.rangeAtr >= PARTICIPATION_MIN_RANGE_ATR &&
      typeof participation.volumeMultiple20 === "number" &&
      participation.volumeMultiple20 >= PARTICIPATION_MIN_VOL_MULT;

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

    const nearLevel = (side === "buy" && nearSupport) || (side === "sell" && nearResistance);
    const trendAligned = sideTrend1d === side || sideTrend1h === side || sideTrend15 === side;
    const momentumSetup = (momentumAligned || strongDailyMomentumSide !== null) && hasParticipation;
    const explicitSetup = breakout !== null || momentumSetup || (nearLevel && trendAligned);

    let score = 0;
    score += Math.round(trendStrength * 900);

    score += (signals15.length + signals1h.length + signals1d.length) * 2;

    if (typeof roc1d === "number") {
      score += Math.round(Math.min(60, Math.abs(roc1d) * 1200));
    }
    if (typeof roc1h === "number") {
      score += Math.round(Math.min(45, Math.abs(roc1h) * 4500));
    }
    if (typeof roc15 === "number") {
      score += Math.round(Math.min(35, Math.abs(roc15) * 8500));
    }
    if (momentumAligned) {
      score += 25;
    }

    if (breakout) {
      score += breakout.window === 252 ? 55 : breakout.window === 55 ? 40 : 25;
    }

    if (hasParticipation) {
      score += 25;
      if (participation.direction && ((side === "buy" && participation.direction === "up") || (side === "sell" && participation.direction === "down"))) {
        score += 10;
      }
    }

    if (side === "buy" && nearSupport) {
      score += 20;
    }
    if (side === "sell" && nearResistance) {
      score += 20;
    }

    if (absMove1dAtr14 !== null) {
      const baseBonus = absMove1dAtr14 * 6;
      const bigMoveBonus = absMove1dAtr14 >= 2 ? 12 : 0;
      score += Math.round(Math.min(42, baseBonus + bigMoveBonus));
    }

    if (rsi15 !== null) {
      score += Math.round(Math.min(8, Math.abs(rsi15 - 50) / 6));
    }

    const rationale: string[] = [];
    if (breakout) {
      const dirLabel = breakout.direction === "up" ? "above" : "below";
      rationale.push(`Breakout: close ${dirLabel} prior ${breakout.window}d level (${breakout.level.toFixed(2)}).`);
    }

    const momentumLabels: string[] = [];
    if (typeof roc15 === "number") {
      momentumLabels.push(`15m ${roc15 >= 0 ? "+" : ""}${(roc15 * 100).toFixed(1)}%`);
    }
    if (typeof roc1h === "number") {
      momentumLabels.push(`1h ${roc1h >= 0 ? "+" : ""}${(roc1h * 100).toFixed(1)}%`);
    }
    if (typeof roc1d === "number") {
      momentumLabels.push(`1d ${roc1d >= 0 ? "+" : ""}${(roc1d * 100).toFixed(1)}%`);
    }
    if (momentumLabels.length > 0) {
      rationale.push(`Momentum: ${momentumLabels.join(", ")}${momentumAligned ? " (aligned)" : ""}.`);
    }

    if (typeof levels.support === "number" || typeof levels.resistance === "number") {
      const parts: string[] = [];
      if (typeof levels.support === "number") {
        const dist = typeof supportDistAtr === "number" ? ` (${supportDistAtr.toFixed(2)} ATR)` : "";
        parts.push(`support ${levels.support.toFixed(2)}${dist}`);
      }
      if (typeof levels.resistance === "number") {
        const dist = typeof resistanceDistAtr === "number" ? ` (${resistanceDistAtr.toFixed(2)} ATR)` : "";
        parts.push(`resistance ${levels.resistance.toFixed(2)}${dist}`);
      }
      if (parts.length > 0) {
        rationale.push(`Levels (1d pivots): ${parts.join("; ")}.`);
      }
    }

    if (hasParticipation) {
      const dirLabel =
        participation.direction === "up" ? "demand" : participation.direction === "down" ? "supply" : "participation";
      const rangeLabel = typeof participation.rangeAtr === "number" ? `${participation.rangeAtr.toFixed(1)} ATR range` : "";
      const volLabel =
        typeof participation.volumeMultiple20 === "number" ? `${participation.volumeMultiple20.toFixed(1)}x vol` : "";
      const joiner = rangeLabel && volLabel ? ", " : "";
      rationale.push(`Supply/demand proxy: ${rangeLabel}${joiner}${volLabel} (${dirLabel}).`);
    }

    if (atr1d !== null) {
      let moveLabel = "";
      if (move1d !== null && absMove1dAtr14 !== null) {
        const quiet = absMove1dAtr14 < MIN_TRADE_ABS_MOVE_ATR ? " (quiet)" : "";
        moveLabel = `; 1d move ${move1d >= 0 ? "+" : ""}${move1d.toFixed(2)} (${absMove1dAtr14.toFixed(1)} ATR)${quiet}`;
      }
      rationale.push(`1d ATR14: ${atr1d.toFixed(2)}${moveLabel}`);
    }
    if (signals1d.length > 0) {
      rationale.push(`1d signals: ${signals1d.slice(0, 3).join("; ")}`);
    }
    if (signals1h.length > 0) {
      rationale.push(`1h signals: ${signals1h.slice(0, 3).join("; ")}`);
    }
    if (signals15.length > 0) {
      rationale.push(`15m signals: ${signals15.slice(0, 3).join("; ")}`);
    }
    if (sideTrend1d) {
      rationale.push(`1d trend bias: ${sideTrend1d === "buy" ? "bullish" : "bearish"}`);
    }
    if (!explicitSetup) {
      rationale.push("Trend-following watchlist setup (no breakout/momentum/level trigger on the latest bar).");
    } else if (!breakout && absMove1dAtr14 !== null && absMove1dAtr14 < MIN_TRADE_ABS_MOVE_ATR) {
      rationale.push("Setup present but 1d move < 1 ATR; kept on the watchlist.");
    }
    if (rationale.length === 0) {
      rationale.push("Trend continuation setup (no explicit rule hit on the latest bar).");
    }

    candidates.push({
      symbol,
      basis: explicitSetup ? "signal" : "trend",
      score,
      trade: buildTradePlan(series15m, side, atr1d),
      atr14_1d: atr1d,
      move1d,
      move1dAtr14,
      absMove1dAtr14,
      rationale,
      signals: {
        "15m": signals15,
        "1h": signals1h,
        "1d": signals1d
      },
      breakout,
      hasParticipation
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  function stripCandidate(candidate: Candidate): ReportPick {
    const { absMove1dAtr14, breakout, hasParticipation, ...pick } = candidate;
    void absMove1dAtr14;
    void breakout;
    void hasParticipation;
    return pick;
  }

  function isTechnicalTrade(candidate: Candidate): boolean {
    const moveOk = candidate.absMove1dAtr14 === null || candidate.absMove1dAtr14 >= MIN_TRADE_ABS_MOVE_ATR;
    const breakoutOk = candidate.breakout !== null && candidate.hasParticipation;
    return candidate.basis === "signal" && (moveOk || breakoutOk);
  }

  function isWatchlistEntry(candidate: Candidate, picked: Set<string>): boolean {
    if (picked.has(candidate.symbol)) {
      return false;
    }

    const subAtr = candidate.absMove1dAtr14 !== null && candidate.absMove1dAtr14 < MIN_TRADE_ABS_MOVE_ATR;
    return candidate.basis === "trend" || subAtr;
  }

  const picks = candidates.filter(isTechnicalTrade).slice(0, REPORT_MAX_PICKS).map(stripCandidate);

  const pickSymbols = new Set(picks.map((p) => p.symbol));

  const watchlist = candidates
    .filter((c) => isWatchlistEntry(c, pickSymbols))
    .slice(0, REPORT_MAX_WATCHLIST)
    .map(stripCandidate);

  return { picks, watchlist };
}

function buildSummaries(
  date: string,
  picks: ReportPick[],
  watchlist: ReportPick[],
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>,
  seriesBySymbol: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>>,
  missingSymbols: string[]
): MarketReport["summaries"] {
  function median(values: number[]): number | null {
    const sorted = values.slice().sort((a, b) => a - b);
    if (sorted.length === 0) {
      return null;
    }

    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

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
    REPORT_VERY_SHORT_MAX_WORDS
  );

  let breadthUp = 0;
  let breadthDown = 0;
  let breadthFlat = 0;
  let breadthTotal = 0;
  let breakoutsUp = 0;
  let breakoutsDown = 0;
  const dollarVolumes: Array<{ symbol: string; dollarVolume1d: number }> = [];

  for (const symbol of Object.keys(analyzedBySymbol)) {
    const series1d = analyzedBySymbol[symbol]?.["1d"];
    if (!series1d) {
      continue;
    }

    const last = series1d.bars.at(-1);
    const prev = series1d.bars.at(-2);
    if (last && prev && Number.isFinite(last.c) && Number.isFinite(prev.c) && prev.c !== 0) {
      const ret = (last.c - prev.c) / prev.c;
      breadthTotal += 1;
      if (ret > 0) {
        breadthUp += 1;
      } else if (ret < 0) {
        breadthDown += 1;
      } else {
        breadthFlat += 1;
      }
    }

    if (symbol !== "^VIX") {
      const breakout = detectDailyBreakout(series1d);
      if (breakout?.direction === "up") {
        breakoutsUp += 1;
      } else if (breakout?.direction === "down") {
        breakoutsDown += 1;
      }
    }

    if (last) {
      const dollarVolume1d = safeDollarVolume(last);
      if (dollarVolume1d !== null) {
        dollarVolumes.push({ symbol, dollarVolume1d });
      }
    }
  }

  const breadthPct = breadthTotal > 0 ? breadthUp / breadthTotal : null;

  dollarVolumes.sort((a, b) => b.dollarVolume1d - a.dollarVolume1d || a.symbol.localeCompare(b.symbol));
  const totalDollarVolume = dollarVolumes.reduce((sum, v) => sum + v.dollarVolume1d, 0);
  const top10DollarVolume = dollarVolumes.slice(0, 10).reduce((sum, v) => sum + v.dollarVolume1d, 0);
  const concentrationPct = totalDollarVolume > 0 ? top10DollarVolume / totalDollarVolume : null;

  const vixSeries = analyzedBySymbol["^VIX"]?.["1d"];
  const vixLast = vixSeries?.bars.at(-1);
  const vixPrev = vixSeries?.bars.at(-2);
  const vixClose = vixLast && Number.isFinite(vixLast.c) ? vixLast.c : null;
  const vixChangePct =
    vixLast && vixPrev && Number.isFinite(vixLast.c) && Number.isFinite(vixPrev.c) && vixPrev.c !== 0
      ? (vixLast.c - vixPrev.c) / vixPrev.c
      : null;

  const regimeParts: string[] = [];
  if (breadthTotal > 0) {
    const breadthPercentsExact = [breadthUp, breadthDown, breadthFlat].map((count) => (count * 100) / breadthTotal);
    const breadthPercentsRounded = breadthPercentsExact.map((pct) => Math.floor(pct));
    const breadthPercentsRemaining = 100 - breadthPercentsRounded.reduce((sum, pct) => sum + pct, 0);

    const breadthPercentsByRemainder = breadthPercentsExact
      .map((pct, idx) => ({ idx, remainder: pct - Math.floor(pct) }))
      .sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);

    for (let i = 0; i < breadthPercentsRemaining && i < breadthPercentsByRemainder.length; i += 1) {
      const idx = breadthPercentsByRemainder[i]?.idx;
      if (idx === undefined) {
        continue;
      }
      breadthPercentsRounded[idx] += 1;
    }

    const [breadthUpPct, breadthDownPct, breadthFlatPct] = breadthPercentsRounded;
    regimeParts.push(
      `breadth ${breadthUpPct}% up / ${breadthDownPct}% down / ${breadthFlatPct}% flat (${breadthUp}/${breadthDown}/${breadthFlat}/${breadthTotal})`
    );
  }
  if (vixClose !== null) {
    const vixPctLabel =
      vixChangePct !== null ? ` (${vixChangePct >= 0 ? "+" : ""}${(vixChangePct * 100).toFixed(1)}%)` : "";
    regimeParts.push(`VIX ${vixClose.toFixed(1)}${vixPctLabel}`);
  }
  if (concentrationPct !== null) {
    regimeParts.push(`concentration top10 ${(concentrationPct * 100).toFixed(0)}% of $vol`);
  }
  if (breakoutsUp + breakoutsDown > 0) {
    regimeParts.push(`breakouts ${breakoutsUp}↑/${breakoutsDown}↓ (20/55/252d)`);
  }

  let regimeLabel: string | null = null;
  if (breadthPct !== null && vixChangePct !== null) {
    if (breadthPct >= 0.55 && vixChangePct <= -0.02) {
      regimeLabel = "risk-on";
    } else if (breadthPct <= 0.45 && vixChangePct >= 0.02) {
      regimeLabel = "risk-off";
    } else {
      regimeLabel = "mixed";
    }
  } else if (breadthPct !== null) {
    regimeLabel = breadthPct >= 0.55 ? "risk-on" : breadthPct <= 0.45 ? "risk-off" : "mixed";
  }

  const absMoveAtrValues: number[] = [];
  for (const symbol of Object.keys(analyzedBySymbol)) {
    const series1d = analyzedBySymbol[symbol]?.["1d"];
    if (!series1d) {
      continue;
    }

    const absMoveAtr = computeMoveAtr1d(series1d).absMove1dAtr14;
    if (absMoveAtr !== null) {
      absMoveAtrValues.push(absMoveAtr);
    }
  }

  const medAbsMoveAtr = median(absMoveAtrValues);
  const movedAtLeast1Atr = absMoveAtrValues.filter((v) => v >= 1).length;
  const movedAtLeast2Atr = absMoveAtrValues.filter((v) => v >= 2).length;

  const mainIdeaParts: string[] = [];
  if (regimeParts.length > 0) {
    const label = regimeLabel ? `${regimeLabel}: ` : "";
    mainIdeaParts.push(`Fear/greed + concentration: ${label}${regimeParts.join("; ")}.`);
  }
  if (medAbsMoveAtr !== null) {
    mainIdeaParts.push(
      `Volatility context: median 1d move was ${medAbsMoveAtr.toFixed(1)} ATR (≥1 ATR: ${movedAtLeast1Atr}; ≥2 ATR: ${movedAtLeast2Atr}).`
    );
  }
  if (picks.length === 0 && lines.length === 0) {
    mainIdeaParts.push(
      "Across the configured universe, the ruleset did not flag aligned momentum, breakouts, or key level interactions on the latest bar."
    );
  } else if (picks.length > 0) {
    mainIdeaParts.push(
      `Top setups today: ${picks
        .slice(0, REPORT_MAX_PICKS)
        .map((p) => `${p.symbol} ${p.trade.side}`)
        .join(", ")}.`
    );
  } else if (watchlist.length > 0) {
    mainIdeaParts.push(
      `No high-conviction technical trades met the filter today; watchlist: ${watchlist
        .slice(0, REPORT_MAX_PICKS)
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
  if (regimeParts.length > 0) {
    const label = regimeLabel ? `${regimeLabel}: ` : "";
    summaryParts.push(`Risk tone (fear/greed + concentration): ${label}${regimeParts.join("; ")}.`);
  }
  if (picks.length > 0) {
    summaryParts.push("Top setups:");
    for (const p of picks) {
      summaryParts.push(
        `- ${p.symbol}: ${p.trade.side.toUpperCase()} entry ${p.trade.entry.toFixed(2)}, stop ${p.trade.stop.toFixed(2)}`
      );
    }
  } else if (watchlist.length > 0) {
    summaryParts.push("Watchlist:");
    for (const p of watchlist.slice(0, REPORT_MAX_WATCHLIST)) {
      const basis = p.basis === "trend" ? "trend" : p.basis === "signal" ? "sub-ATR signal" : "watchlist";
      summaryParts.push(`- ${p.symbol}: ${p.trade.side.toUpperCase()} (${basis})`);
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

  const { picks, watchlist } = buildPicks({ analyzedBySymbol });
  const mostActive = buildMostActive({ analyzedBySymbol });
  const summaries = buildSummaries(args.date, picks, watchlist, analyzedBySymbol, seriesBySymbol, args.missingSymbols);

  return {
    date: args.date,
    generatedAt: new Date().toISOString(),
    symbols: args.symbols,
    intervals: args.intervals,
    missingSymbols: args.missingSymbols,
    picks,
    watchlist: watchlist.length > 0 ? watchlist : undefined,
    series: seriesBySymbol,
    mostActive,
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

  lines.push("## Technical trades");
  lines.push("");
  if (report.picks.length === 0) {
    lines.push("No clear trade setups today based on the configured rules + filters.");
    lines.push("");
  } else {
    for (const pick of report.picks) {
      lines.push(`### ${pick.symbol}`);
      lines.push("");
      lines.push(`<ReportPick symbol="${pick.symbol}" />`);
      lines.push("");
    }
  }

  if (report.watchlist?.length) {
    lines.push("## Watchlist");
    lines.push("");
    for (const p of report.watchlist.slice(0, REPORT_MAX_WATCHLIST)) {
      const basis = p.basis === "trend" ? "trend" : p.basis === "signal" ? "sub-ATR signal" : "watchlist";
      const atrLabel =
        typeof p.move1dAtr14 === "number" && Number.isFinite(p.move1dAtr14)
          ? ` | ${Math.abs(p.move1dAtr14).toFixed(1)} ATR`
          : "";
      lines.push(`- ${p.symbol}: ${p.trade.side.toUpperCase()} (${basis})${atrLabel}`);
    }
    lines.push("");
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
