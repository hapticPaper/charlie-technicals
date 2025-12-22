import YahooFinance from "yahoo-finance2";

import { parseIsoDateYmd } from "../date";
import {
  buildNewsMainIdea,
  buildNewsSummary,
  clampRelatedTickers,
  fetchArticleMeta,
  isRecentNews
} from "../news";
import type { MarketBar, MarketInterval, MarketNewsArticle, MarketNewsSnapshot, RawSeries } from "../types";

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
  // Observed provider errors when requesting >= 60 calendar days for 5m/15m intervals:
  // "The requested range must be within the last 60 days".
  // Using 59 days avoids edge/off-by-one issues around partial days.
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

    const now = Date.now();

    const retentionDays = yahooRetentionDaysFor(interval);

    let requestedPeriod2: Date;
    if (asOfDate) {
      let parsed;
      try {
        parsed = parseIsoDateYmd(asOfDate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`[yahoo:fetchSeries] Invalid asOfDate '${asOfDate}': ${message}`);
      }

      const { year, month, day } = parsed;
      requestedPeriod2 = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    } else {
      requestedPeriod2 = new Date(now);
    }
    // For intraday requests, clamp `period2` to "now" to avoid asking Yahoo for future bars.
    const period2 =
      retentionDays !== null
        ? new Date(Math.min(requestedPeriod2.getTime(), now))
        : requestedPeriod2;
    const lookbackDays =
      retentionDays !== null ? Math.min(lookbackDaysFor(interval), retentionDays) : lookbackDaysFor(interval);
    const desiredPeriod1 = new Date(period2.getTime() - lookbackDays * DAY_MS);

    let period1 = desiredPeriod1;

    // Yahoo's intraday retention is relative to "now" (not the requested `period2`).
    // When backfilling recent dates, clamp `period1` into the supported window to avoid
    // hard failures like: "The requested range must be within the last 60 days".
    if (retentionDays !== null) {
      const oldestAllowedPeriod1 = new Date(now - retentionDays * DAY_MS);

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
        // Return an empty series to avoid provider errors during backfills.
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

  async fetchNews(symbol: string, asOfDate: string): Promise<MarketNewsSnapshot> {
    const fetchedAt = new Date().toISOString();

    const res = await this.#yf.search(symbol, {
      quotesCount: 0,
      newsCount: 10,
      region: "US",
      lang: "en-US"
    });

    const items = Array.isArray(res.news) ? res.news : [];
    const recent = items
      .filter((n) => n.providerPublishTime instanceof Date)
      .filter((n) => isRecentNews({ asOfDate, publishedAt: n.providerPublishTime, maxAgeDays: 14 }));

    if (recent.length === 0) {
      return {
        symbol,
        provider: "yahoo-finance",
        fetchedAt,
        asOfDate,
        articles: []
      };
    }

    recent.sort((a, b) => b.providerPublishTime.getTime() - a.providerPublishTime.getTime());
    const top = recent.slice(0, 3);

    const deduped: typeof top = [];
    const seen = new Set<string>();
    for (const n of top) {
      const key = `${n.link}::${n.title}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(n);
    }

    const articles: MarketNewsArticle[] = [];

    for (const n of deduped) {
      const url = n.link;
      const title = n.title;
      const publisher = n.publisher;
      const publishedAt = n.providerPublishTime instanceof Date ? n.providerPublishTime.toISOString() : "";
      const relatedTickers = clampRelatedTickers(n.relatedTickers, symbol);

      let description: string | undefined;
      try {
        const meta = await fetchArticleMeta(url);
        description = meta.description;
      } catch {
        description = undefined;
      }

      const mainIdea = buildNewsMainIdea(title);
      const summary = buildNewsSummary({ title, publisher, description, relatedTickers });

      articles.push({
        id: n.uuid,
        title,
        url,
        publisher,
        publishedAt,
        relatedTickers,
        mainIdea,
        summary
      });
    }

    return {
      symbol,
      provider: "yahoo-finance",
      fetchedAt,
      asOfDate,
      articles
    };
  }
}
