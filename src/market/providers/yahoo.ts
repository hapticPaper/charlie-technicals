import YahooFinance from "yahoo-finance2";

import type { MarketBar, MarketInterval, RawSeries } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

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

// Yahoo only serves intraday data back to a rolling retention window.
// This returns the max number of days we can safely request for each interval.
// `null` means we don't enforce a strict provider retention cap.
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

    const retentionDays = yahooRetentionDaysFor(interval);

    const requestedPeriod2 = asOfDate ? new Date(`${asOfDate}T23:59:59.999Z`) : new Date();
    const period2 =
      retentionDays !== null
        ? new Date(Math.min(requestedPeriod2.getTime(), Date.now()))
        : requestedPeriod2;
    const desiredPeriod1 = new Date(period2.getTime() - lookbackDaysFor(interval) * DAY_MS);

    let period1 = desiredPeriod1;

    // Yahoo's intraday retention is relative to "now" (not the requested `period2`).
    // When backfilling recent dates, clamp `period1` into the supported window to avoid
    // hard failures like: "The requested range must be within the last 60 days".
    if (retentionDays !== null) {
      const oldestAllowedPeriod1 = new Date(Date.now() - retentionDays * DAY_MS);

      if (period2.getTime() < oldestAllowedPeriod1.getTime()) {
        return {
          symbol,
          interval,
          provider: "yahoo-finance",
          fetchedAt,
          bars: []
        };
      }

      if (period1.getTime() < oldestAllowedPeriod1.getTime()) {
        period1 = oldestAllowedPeriod1;
      }

      if (period1.getTime() >= period2.getTime()) {
        // No valid window remains after applying provider retention clamping.
        return {
          symbol,
          interval,
          provider: "yahoo-finance",
          fetchedAt,
          bars: []
        };
      }
    }

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
