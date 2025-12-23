import type {
  BollingerBandsSeries,
  KeltnerChannelsSeries,
  MacdSeries,
  MarketBar,
  TtmSqueezeSeries
} from "./types";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function sma(values: Array<number | null>, period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`SMA period must be > 0, got ${period}`);
  }

  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (isFiniteNumber(v)) {
      sum += v;
      count += 1;
    }

    const dropIndex = i - period;
    if (dropIndex >= 0) {
      const drop = values[dropIndex];
      if (isFiniteNumber(drop)) {
        sum -= drop;
        count -= 1;
      }
    }

    if (i >= period - 1 && count === period) {
      out[i] = sum / period;
    }
  }

  return out;
}

export function ema(values: Array<number | null>, period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`EMA period must be > 0, got ${period}`);
  }

  const out: Array<number | null> = new Array(values.length).fill(null);
  const k = 2 / (period + 1);

  let prev: number | null = null;
  const seed = sma(values, period);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const seeded = seed[i];

    if (prev === null) {
      if (isFiniteNumber(seeded)) {
        prev = seeded;
        out[i] = prev;
      }
      continue;
    }

    if (!isFiniteNumber(v)) {
      out[i] = prev;
      continue;
    }

    prev = (v - prev) * k + prev;
    out[i] = prev;
  }

  return out;
}

export function rsi(values: Array<number | null>, period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`RSI period must be > 0, got ${period}`);
  }

  const out: Array<number | null> = new Array(values.length).fill(null);
  let avgGain: number | null = null;
  let avgLoss: number | null = null;

  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const curr = values[i];
    if (!isFiniteNumber(prev) || !isFiniteNumber(curr)) {
      continue;
    }

    const change = curr - prev;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (i <= period) {
      avgGain = (avgGain ?? 0) + gain;
      avgLoss = (avgLoss ?? 0) + loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
      }
      continue;
    }

    if (avgGain === null || avgLoss === null) {
      continue;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      out[i] = 100;
      continue;
    }

    const rs = avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

export function macd(
  values: Array<number | null>,
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): MacdSeries {
  if (fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0) {
    throw new Error("MACD periods must all be > 0");
  }
  if (fastPeriod >= slowPeriod) {
    throw new Error(`MACD fastPeriod must be < slowPeriod (${fastPeriod} vs ${slowPeriod})`);
  }

  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const macdLine: Array<number | null> = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i += 1) {
    const f = fast[i];
    const s = slow[i];
    if (isFiniteNumber(f) && isFiniteNumber(s)) {
      macdLine[i] = f - s;
    }
  }

  const signal = ema(macdLine, signalPeriod);
  const histogram: Array<number | null> = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    const m = macdLine[i];
    const sig = signal[i];
    if (isFiniteNumber(m) && isFiniteNumber(sig)) {
      histogram[i] = m - sig;
    }
  }

  return { macd: macdLine, signal, histogram };
}

export function stdev(values: Array<number | null>, period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`stdev period must be > 0, got ${period}`);
  }

  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (isFiniteNumber(v)) {
      sum += v;
      sumSq += v * v;
      count += 1;
    }

    const dropIndex = i - period;
    if (dropIndex >= 0) {
      const drop = values[dropIndex];
      if (isFiniteNumber(drop)) {
        sum -= drop;
        sumSq -= drop * drop;
        count -= 1;
      }
    }

    // Only emit when the last `period` samples are all finite.
    if (i >= period - 1 && count === period) {
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      out[i] = Math.sqrt(Math.max(0, variance));
    }
  }

  return out;
}

export function highest(values: Array<number | null>, period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`highest period must be > 0, got ${period}`);
  }

  // O(n * period) is acceptable here because the configured periods are small.
  const out: Array<number | null> = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    let max = -Infinity;
    let count = 0;

    for (let j = i - period + 1; j <= i; j += 1) {
      const v = values[j];
      if (!isFiniteNumber(v)) {
        continue;
      }
      count += 1;
      max = Math.max(max, v);
    }

    out[i] = count === period ? max : null;
  }

  return out;
}

export function lowest(values: Array<number | null>, period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`lowest period must be > 0, got ${period}`);
  }

  // O(n * period) is acceptable here because the configured periods are small.
  const out: Array<number | null> = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    let min = Infinity;
    let count = 0;

    for (let j = i - period + 1; j <= i; j += 1) {
      const v = values[j];
      if (!isFiniteNumber(v)) {
        continue;
      }
      count += 1;
      min = Math.min(min, v);
    }

    out[i] = count === period ? min : null;
  }

  return out;
}

function trueRange(bars: MarketBar[]): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const prev = bars[i - 1];
    const high = b?.h;
    const low = b?.l;
    const prevClose = prev?.c;

    if (!isFiniteNumber(high) || !isFiniteNumber(low)) {
      continue;
    }

    const hl = high - low;
    if (!isFiniteNumber(prevClose)) {
      out[i] = hl;
      continue;
    }

    out[i] = Math.max(hl, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  return out;
}

export function atr(bars: MarketBar[], period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`ATR period must be > 0, got ${period}`);
  }

  const tr = trueRange(bars);
  const seed = sma(tr, period);
  const out: Array<number | null> = new Array(bars.length).fill(null);

  let prev: number | null = null;
  for (let i = 0; i < bars.length; i += 1) {
    const seeded = seed[i];
    if (prev === null) {
      if (isFiniteNumber(seeded)) {
        prev = seeded;
        out[i] = prev;
      }
      continue;
    }

    const currTr = tr[i];
    if (!isFiniteNumber(currTr)) {
      out[i] = null;
      continue;
    }

    prev = (prev * (period - 1) + currTr) / period;
    out[i] = prev;
  }

  return out;
}

export function bollingerBands(
  values: Array<number | null>,
  period: number,
  stdevMult: number
): BollingerBandsSeries {
  if (!(typeof stdevMult === "number" && Number.isFinite(stdevMult) && stdevMult > 0)) {
    throw new Error(`Bollinger stdevMult must be > 0, got ${stdevMult}`);
  }

  const middle = sma(values, period);
  const sd = stdev(values, period);
  const upper: Array<number | null> = new Array(values.length).fill(null);
  const lower: Array<number | null> = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i += 1) {
    const m = middle[i];
    const s = sd[i];
    if (!isFiniteNumber(m) || !isFiniteNumber(s)) {
      continue;
    }

    upper[i] = m + s * stdevMult;
    lower[i] = m - s * stdevMult;
  }

  return { middle, upper, lower };
}

export function keltnerChannels(
  bars: MarketBar[],
  period: number,
  atrMult: number
): KeltnerChannelsSeries {
  if (!(typeof atrMult === "number" && Number.isFinite(atrMult) && atrMult > 0)) {
    throw new Error(`Keltner atrMult must be > 0, got ${atrMult}`);
  }

  const close = bars.map((b) => (isFiniteNumber(b.c) ? b.c : null));
  const middle = ema(close, period);
  const range = atr(bars, period);
  const upper: Array<number | null> = new Array(bars.length).fill(null);
  const lower: Array<number | null> = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i += 1) {
    const m = middle[i];
    const r = range[i];
    if (!isFiniteNumber(m) || !isFiniteNumber(r)) {
      continue;
    }

    upper[i] = m + r * atrMult;
    lower[i] = m - r * atrMult;
  }

  return { middle, upper, lower };
}

export function linreg(values: Array<number | null>, period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error(`linreg period must be > 0, got ${period}`);
  }

  const out: Array<number | null> = new Array(values.length).fill(null);
  const n = period;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const denom = n * sumX2 - sumX * sumX;

  for (let i = period - 1; i < values.length; i += 1) {
    let sumY = 0;
    let sumXY = 0;
    let count = 0;

    for (let j = 0; j < period; j += 1) {
      const y = values[i - period + 1 + j];
      if (!isFiniteNumber(y)) {
        continue;
      }

      count += 1;
      sumY += y;
      sumXY += j * y;
    }

    if (count !== period) {
      continue;
    }

    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    out[i] = intercept + slope * (n - 1);
  }

  return out;
}

export function ttmSqueeze(
  bars: MarketBar[],
  period: number,
  bbMult: number,
  kcMult: number
): TtmSqueezeSeries {
  if (!(typeof bbMult === "number" && Number.isFinite(bbMult) && bbMult > 0)) {
    throw new Error(`TTM Squeeze bbMult must be > 0, got ${bbMult}`);
  }
  if (!(typeof kcMult === "number" && Number.isFinite(kcMult) && kcMult > 0)) {
    throw new Error(`TTM Squeeze kcMult must be > 0, got ${kcMult}`);
  }

  const close = bars.map((b) => (isFiniteNumber(b.c) ? b.c : null));
  const high = bars.map((b) => (isFiniteNumber(b.h) ? b.h : null));
  const low = bars.map((b) => (isFiniteNumber(b.l) ? b.l : null));

  const bollinger = bollingerBands(close, period, bbMult);
  const keltner = keltnerChannels(bars, period, kcMult);

  const squeezeOn: Array<boolean | null> = new Array(bars.length).fill(null);
  const squeezeOff: Array<boolean | null> = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i += 1) {
    const bbU = bollinger.upper[i];
    const bbL = bollinger.lower[i];
    const kcU = keltner.upper[i];
    const kcL = keltner.lower[i];
    if (!isFiniteNumber(bbU) || !isFiniteNumber(bbL) || !isFiniteNumber(kcU) || !isFiniteNumber(kcL)) {
      continue;
    }

    squeezeOn[i] = bbU < kcU && bbL > kcL;
    squeezeOff[i] = bbU > kcU && bbL < kcL;
  }

  const highestHigh = highest(high, period);
  const lowestLow = lowest(low, period);
  const smaClose = sma(close, period);

  const source: Array<number | null> = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i += 1) {
    const c = close[i];
    const hh = highestHigh[i];
    const ll = lowestLow[i];
    const sm = smaClose[i];
    if (!isFiniteNumber(c) || !isFiniteNumber(hh) || !isFiniteNumber(ll) || !isFiniteNumber(sm)) {
      continue;
    }

    const mid = (hh + ll) / 2;
    const mean = (mid + sm) / 2;
    source[i] = c - mean;
  }

  const momentum = linreg(source, period);

  return {
    bollinger,
    keltner,
    squeezeOn,
    squeezeOff,
    momentum
  };
}
