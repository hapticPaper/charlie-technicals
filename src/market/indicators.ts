import type { MacdSeries } from "./types";

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
