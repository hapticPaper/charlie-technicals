import YahooFinance from "yahoo-finance2";

import type { MarketBar, MarketInterval, RawSeries } from "../types";

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
    case "1d":
      return 730;
  }
}

function yahooRetentionDaysFor(interval: MarketInterval): number | null {
  switch (interval) {
    case "1m":
      return 7;
    case "5m":
      return 59;
    case "15m":
      return 59;
    case "1h":
    case "1d":
      return null;
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
    const yahooInterval = interval;

    const period2 = asOfDate ? new Date(`${asOfDate}T23:59:59.999Z`) : new Date();
    const desiredPeriod1 = new Date(
      period2.getTime() - lookbackDaysFor(interval) * 24 * 60 * 60 * 1000
    );

    const retentionDays = yahooRetentionDaysFor(interval);
    const oldestAllowedPeriod1 =
      retentionDays === null
        ? null
        : new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    if (oldestAllowedPeriod1 !== null && period2.getTime() < oldestAllowedPeriod1.getTime()) {
      return {
        symbol,
        interval,
        provider: "yahoo-finance",
        fetchedAt,
        bars: []
      };
    }

    const period1 =
      oldestAllowedPeriod1 !== null && desiredPeriod1.getTime() < oldestAllowedPeriod1.getTime()
        ? oldestAllowedPeriod1
        : desiredPeriod1;

    const res = await this.#yf.chart(symbol, { interval: yahooInterval, period1, period2 });
    if (!Array.isArray(res.quotes) || res.quotes.length === 0) {
      return {
        symbol,
        interval,
        provider: "yahoo-finance",
        fetchedAt,
        bars: []
      };
    }

    const bars = toMarketBars(res.quotes as Array<Record<string, unknown>>);

    const cappedBars = bars.slice(Math.max(0, bars.length - maxBarsFor(interval)));

    return {
      symbol,
      interval,
      provider: "yahoo-finance",
      fetchedAt,
      bars: cappedBars
    };
  }
}
