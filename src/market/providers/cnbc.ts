import type { MarketNewsArticle, MarketNewsSnapshot } from "../types";

import { formatDateYYYYMMDD } from "../../lib/date";

import { parseIsoDateYmd } from "../date";

import {
  buildNewsMainIdea,
  buildNewsSummary,
  inferNewsTopic,
  scoreNewsHype
} from "../news";

const CNBC_PUBLISHER = "CNBC";
const CNBC_WEBQL_URL = "https://webql-redesign.cnbcfm.com/graphql";

// Keep a short rolling window so the daily report has enough videos to work with,
// even when run early in the NY morning.
const CNBC_LOOKBACK_DAYS = 14;

const CNBC_SEARCH_QUERY = `query search($tag: String, $page: Int!, $pageSize: Int!, $contentType: [assetTypeValues]!) {
  search(tag: $tag, page: $page, pageSize: $pageSize, contentType: $contentType) {
    assets: results {
      id
      type
      url
      promoImage {
        url
      }
      datePublished
      description
      title
      headline
      contentClassification
      section {
        title
        eyebrow
      }
    }
  }
}`;

function parseCnbcVideoUrlYmd(url: string): string | null {
  const match = url.match(/\/video\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
}

function parseCnbcTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  const fixedTz = trimmed.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(fixedTz);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildCnbcVideoId(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // ["video", "YYYY", "MM", "DD", "slug.html"]
    if (parts.length >= 5 && parts[0] === "video") {
      const [, y, m, d, slug] = parts;
      const base = slug?.replace(/\.html$/i, "");
      if (y && m && d && base) {
        return `cnbc:${y}${m}${d}:${base}`;
      }
    }
  } catch {
    // fall back below
  }

  return `cnbc:${url}`;
}

/**
* Shift a strict ISO `YYYY-MM-DD` date by `deltaDays` in UTC calendar days.
*
* Uses 12:00:00Z as the base time to avoid DST edge cases and returns a zero-padded ISO `YYYY-MM-DD` string.
*/
function shiftIsoDateYmd(date: string, deltaDays: number): string {
  // `parseIsoDateYmd` validates `date` is a real calendar day in strict `YYYY-MM-DD` format.
  const { year, month, day } = parseIsoDateYmd(date);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  if (timeoutMs <= 0) {
    throw new Error(`timeoutMs must be > 0, got ${timeoutMs} for ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return await res.json();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError"
    ) {
      throw new Error(`Timed out after ${timeoutMs}ms for ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

type CnbcVideoAsset = {
  id: number;
  type: string;
  url: string;
  promoImage?: {
    url?: string | null;
  } | null;
  datePublished?: string | null;
  description?: string | null;
  title?: string | null;
  headline?: string | null;
  contentClassification?: string[] | null;
  section?: {
    title?: string | null;
    eyebrow?: string | null;
  } | null;
};

type CnbcSearchResponse = {
  data?: {
    search?: {
      assets?: CnbcVideoAsset[] | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

export class CnbcVideoProvider {
  private async fetchSearchPage(page: number, pageSize: number): Promise<{ assets: CnbcVideoAsset[] }> {
    const body = {
      query: CNBC_SEARCH_QUERY,
      variables: {
        tag: null as string | null,
        page,
        pageSize,
        contentType: ["cnbcvideo"] as string[]
      }
    };

    const json = await fetchJson(
      CNBC_WEBQL_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "charlie-technicals/1.0 (+https://github.com/hapticPaper/charlie-technicals)"
        },
        body: JSON.stringify(body)
      },
      10_000
    );

    const parsed = json as CnbcSearchResponse;
    if (parsed.errors && parsed.errors.length > 0) {
      const message = parsed.errors.map((e) => e.message).filter(Boolean).join("; ");
      throw new Error(message ? `[market:cnbc] GraphQL errors: ${message}` : "[market:cnbc] GraphQL errors");
    }

    const assets = Array.isArray(parsed.data?.search?.assets) ? parsed.data.search.assets.filter(Boolean) : [];
    return { assets };
  }

  /**
  * Fetch a rolling window of CNBC videos ending on `asOfDate` (NY calendar date).
  */
  async fetchNews(args: {
    asOfDate: string;
    maxUrls?: number;
  }): Promise<{ snapshot: MarketNewsSnapshot; totalUrls: number; keptUrls: number }> {
    const fetchedAt = new Date().toISOString();

    // Lookback window is computed in UTC ISO days; we only compare `YYYY-MM-DD` strings,
    // so this remains stable even though bucketing is NY-local.
    const windowStartYmd = shiftIsoDateYmd(args.asOfDate, -(CNBC_LOOKBACK_DAYS - 1));

    const maxAssets = Math.max(200, args.maxUrls ?? 2000);
    const pageSize = 100;
    const maxPages = Math.max(1, Math.ceil(maxAssets / pageSize));

    const fetchedAssets: CnbcVideoAsset[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      if (fetchedAssets.length >= maxAssets) {
        break;
      }

      const res = await this.fetchSearchPage(page, pageSize);
      if (res.assets.length === 0) {
        break;
      }

      fetchedAssets.push(...res.assets);
    }

    const articles: MarketNewsArticle[] = [];
    const seenUrls = new Set<string>();
    for (const asset of fetchedAssets) {
      if (asset.type !== "cnbcvideo") {
        continue;
      }

      const url = asset.url;
      if (seenUrls.has(url)) {
        continue;
      }
      seenUrls.add(url);
      const ymd = parseCnbcVideoUrlYmd(url);

      const published = asset.datePublished ? parseCnbcTimestamp(asset.datePublished) : null;
      const fallbackDate = ymd ? new Date(`${ymd}T12:00:00Z`) : new Date(`${args.asOfDate}T12:00:00Z`);
      const publishedAtDate =
        published ?? (Number.isFinite(fallbackDate.getTime()) ? fallbackDate : new Date(`${args.asOfDate}T12:00:00Z`));

      // CNBC URLs embed NY-local calendar dates; we mirror that for day-level bucketing.
      // Note: this can diverge from the UTC date portion of `publishedAt` for videos near midnight.
      const effectiveYmd = ymd ?? formatDateYYYYMMDD(publishedAtDate, "America/New_York");
      // ISO YMD strings are zero-padded, so lexicographic comparison matches chronological ordering.
      if (effectiveYmd > args.asOfDate || effectiveYmd < windowStartYmd) {
        continue;
      }

      const title = asset.title ?? asset.headline;
      if (!title) {
        continue;
      }

      // Best-effort default topic; storage merge preserves any existing human-curated topic values.
      const topic = inferNewsTopic({ title }) ?? "markets";

      // CNBC videos are enriched via the snapshot playbook; keep these fields conservative here.
      const relatedTickers: string[] = [];

      const hype = scoreNewsHype(title);
      const mainIdea = buildNewsMainIdea(title);
      const summary = buildNewsSummary({
        title,
        publisher: CNBC_PUBLISHER,
        description: asset.description ?? undefined,
        relatedTickers
      });

      const thumbnailUrl =
        typeof asset.promoImage?.url === "string" && asset.promoImage.url.trim() !== ""
          ? asset.promoImage.url
          : undefined;

      articles.push({
        id: buildCnbcVideoId(url),
        title,
        url,
        thumbnailUrl,
        publisher: CNBC_PUBLISHER,
        publishedAt: publishedAtDate.toISOString(),
        relatedTickers,
        topic,
        hype,
        mainIdea,
        summary
      });
    }

    const kept = articles;
    kept.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const snapshot: MarketNewsSnapshot = {
      symbol: "cnbc",
      provider: "cnbc",
      fetchedAt,
      asOfDate: args.asOfDate,
      articles: kept
    };

    return { snapshot, totalUrls: fetchedAssets.length, keptUrls: kept.length };
  }
}
