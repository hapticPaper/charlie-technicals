import type { AnalysisConfig, IndicatorDefinition, SignalDefinition } from "./config";
import { atr, bollingerBands, ema, keltnerChannels, macd, rsi, sma, stdev, ttmSqueeze } from "./indicators";
import type { AnalyzedSeries, MacdSeries, MarketBar, MarketInterval, SignalHit } from "./types";

function getCloseSeries(bars: MarketBar[]): Array<number | null> {
  return bars.map((b) => (Number.isFinite(b.c) ? b.c : null));
}

function getMacdField(series: MacdSeries, field: string): Array<number | null> {
  switch (field) {
    case "macd":
      return series.macd;
    case "signal":
      return series.signal;
    case "histogram":
      return series.histogram;
    default:
      throw new Error(`Unknown MACD field: ${field}`);
  }
}

function isMacdSeries(value: unknown): value is MacdSeries {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (!("macd" in value && "signal" in value && "histogram" in value)) {
    return false;
  }

  const { macd: m, signal: s, histogram: h } = value as MacdSeries;
  return Array.isArray(m) && Array.isArray(s) && Array.isArray(h) && m.length === s.length && s.length === h.length;
}

function getValueAt(values: Array<number | null>, index: number): number | null {
  const v = values[index];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function computeIndicators(bars: MarketBar[], indicators: IndicatorDefinition[]): AnalyzedSeries["indicators"] {
  const close = getCloseSeries(bars);
  const out: AnalyzedSeries["indicators"] = {};

  for (const def of indicators) {
    switch (def.type) {
      case "sma":
        out[def.id] = sma(close, def.period);
        break;
      case "ema":
        out[def.id] = ema(close, def.period);
        break;
      case "rsi":
        out[def.id] = rsi(close, def.period);
        break;
      case "stdev":
        out[def.id] = stdev(close, def.period);
        break;
      case "atr":
        out[def.id] = atr(bars, def.period);
        break;
      case "bollingerBands":
        out[def.id] = bollingerBands(close, def.period, def.stdevMult);
        break;
      case "keltnerChannels":
        out[def.id] = keltnerChannels(bars, def.period, def.atrMult);
        break;
      case "ttmSqueeze":
        out[def.id] = ttmSqueeze(bars, def.period, def.bbMult, def.kcMult);
        break;
      case "macd":
        out[def.id] = macd(close, def.fastPeriod, def.slowPeriod, def.signalPeriod);
        break;
      default: {
        const _exhaustive: never = def;
        void _exhaustive;
        throw new Error("Unknown indicator type");
      }
    }
  }

  return out;
}

function evalSignal(def: SignalDefinition, indicators: AnalyzedSeries["indicators"], index: number): boolean {
  const { when } = def;
  const series = indicators[when.indicator];
  if (!series) {
    return false;
  }

  if (when.op === "lt" || when.op === "gt") {
    if (!Array.isArray(series)) {
      return false;
    }

    const current = getValueAt(series, index);
    if (current === null) {
      return false;
    }

    return when.op === "lt" ? current < when.value : current > when.value;
  }

  if (when.op === "crossAbove" || when.op === "crossBelow") {
    if (Array.isArray(series)) {
      return false;
    }

    if (!isMacdSeries(series)) {
      throw new Error(`Signal ${def.id} expected MACD series in indicators.${when.indicator}`);
    }

    const leftSeries = getMacdField(series, when.left);
    const rightSeries = getMacdField(series, when.right);

    const prevLeft = getValueAt(leftSeries, index - 1);
    const prevRight = getValueAt(rightSeries, index - 1);
    const currLeft = getValueAt(leftSeries, index);
    const currRight = getValueAt(rightSeries, index);

    if (prevLeft === null || prevRight === null || currLeft === null || currRight === null) {
      return false;
    }

    if (when.op === "crossAbove") {
      return prevLeft <= prevRight && currLeft > currRight;
    }

    return prevLeft >= prevRight && currLeft < currRight;
  }

  return false;
}

function computeSignals(bars: MarketBar[], cfg: AnalysisConfig, indicators: AnalyzedSeries["indicators"]): SignalHit[] {
  const index = bars.length - 1;
  if (index < 1) {
    return cfg.signals.map((s) => ({ id: s.id, label: s.label, active: false }));
  }

  return cfg.signals.map((s) => ({ id: s.id, label: s.label, active: evalSignal(s, indicators, index) }));
}

export function analyzeSeries(raw: {
  symbol: string;
  interval: MarketInterval;
  bars: MarketBar[];
}): (cfg: AnalysisConfig) => AnalyzedSeries {
  return (cfg) => {
    const indicators = computeIndicators(raw.bars, cfg.indicators);
    const signals = computeSignals(raw.bars, cfg, indicators);

    return {
      symbol: raw.symbol,
      interval: raw.interval,
      analyzedAt: new Date().toISOString(),
      bars: raw.bars,
      indicators,
      signals
    };
  };
}
