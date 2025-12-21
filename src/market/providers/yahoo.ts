import YahooFinance from "yahoo-finance2";

import type { MarketBar, MarketInterval, RawSeries } from "../types";

type YahooInterval = "1m" | "5m" | "15m" | "1h" | "1d";

function toYahooInterval(interval: MarketInterval): YahooInterval {
  if (interval === "4h") {
    return "1h";
  }

  return interval;
}

function lookbackDaysFor(interval: MarketInterval): number {
  switch (interval) {
    case "1m":
      return 5;
    case "5m":
      return 30;
    case "15m":
      return 60;
    case "1h":
      return 180;
    case "4h":
      return 365;
    case "1d":
      return 730;
  }
}

function toMarketBars(quotes: Array<Record<string, unknown>>): MarketBar[] {
  const bars: MarketBar[] = [];

  for (const q of quotes) {
    const date = q.date;
    const open = q.open;
    const high = q.high;
    const low = q.low;
    const close = q.close;
    const volume = q.volume;

    if (!(date instanceof Date)) {
      continue;
    }
    if (
      typeof open !== "number" ||
      typeof high !== "number" ||
      typeof low !== "number" ||
      typeof close !== "number" ||
      typeof volume !== "number" ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }

    bars.push({
      t: date.toISOString(),
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume
    });
  }

  bars.sort((a, b) => a.t.localeCompare(b.t));
  return bars;
}

function resampleTo4h(bars1h: MarketBar[]): MarketBar[] {
  const buckets = new Map<
    string,
    {
      t: string;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }
  >();

  for (const bar of bars1h) {
    const d = new Date(bar.t);
    const bucketHour = Math.floor(d.getUTCHours() / 4) * 4;
    const bucketStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), bucketHour));
    const key = bucketStart.toISOString();

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { t: key, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      continue;
    }

    existing.h = Math.max(existing.h, bar.h);
    existing.l = Math.min(existing.l, bar.l);
    existing.c = bar.c;
    existing.v += bar.v;
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, bar]) => bar);
}

function maxBarsFor(interval: MarketInterval): number {
  switch (interval) {
    case "1m":
      return 500;
    case "5m":
      return 500;
    case "15m":
      return 500;
    case "1h":
      return 700;
    case "4h":
      return 700;
    case "1d":
      return 900;
  }
}

export class YahooMarketDataProvider {
  readonly #yf: InstanceType<typeof YahooFinance>;

  constructor() {
    this.#yf = new YahooFinance();
  }

  async fetchSeries(symbol: string, interval: MarketInterval, asOfDate?: string): Promise<RawSeries> {
    const fetchedAt = new Date().toISOString();
    const yahooInterval = toYahooInterval(interval);

    const period2 = asOfDate ? new Date(`${asOfDate}T23:59:59.999Z`) : new Date();
    const period1 = new Date(period2.getTime() - lookbackDaysFor(interval) * 24 * 60 * 60 * 1000);

    const res = await this.#yf.chart(symbol, { interval: yahooInterval, period1, period2 });
    const bars = toMarketBars(res.quotes as Array<Record<string, unknown>>);

    const finalBars = interval === "4h" ? resampleTo4h(bars) : bars;
    const cappedBars = finalBars.slice(Math.max(0, finalBars.length - maxBarsFor(interval)));

    return {
      symbol,
      interval,
      provider: "yahoo-finance",
      fetchedAt,
      bars: cappedBars
    };
  }
}
