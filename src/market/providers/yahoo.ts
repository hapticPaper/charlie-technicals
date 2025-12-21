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
  const out: MarketBar[] = [];
  for (let i = 0; i < bars1h.length; i += 4) {
    const chunk = bars1h.slice(i, i + 4);
    if (chunk.length < 4) {
      break;
    }

    const open = chunk[0].o;
    const close = chunk[chunk.length - 1].c;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const bar of chunk) {
      high = Math.max(high, bar.h);
      low = Math.min(low, bar.l);
      volume += bar.v;
    }

    out.push({
      t: chunk[0].t,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume
    });
  }

  return out;
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
