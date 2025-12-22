import type { MarketNewsArticle, MarketNewsSnapshot } from "../types";

import {
  buildNewsMainIdea,
  buildNewsSummary,
  fetchArticleMeta,
  inferNewsTopic,
  scoreNewsHype
} from "../news";
import { mapWithConcurrency } from "../concurrency";

const CNBC_LATEST_VIDEO_URL = "https://www.cnbc.com/latest-video/";

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

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  if (timeoutMs <= 0) {
    throw new Error(`timeoutMs must be > 0, got ${timeoutMs} for ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "charlie-technicals/1.0 (+https://github.com/hapticPaper/charlie-technicals)"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
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

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) {
      continue;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

export class CnbcVideoProvider {
  async fetchLatestVideoUrls(): Promise<string[]> {
    const html = await fetchText(CNBC_LATEST_VIDEO_URL, 10_000);
    const matches = html.match(
      /https:\/\/www\.cnbc\.com\/video\/\d{4}\/\d{2}\/\d{2}\/[^"<> ]+\.html(?:\?[^"<> ]*)?/g
    );

    if (!matches || matches.length === 0) {
      const message = `[market:cnbc] no video URLs found at ${CNBC_LATEST_VIDEO_URL}`;
      console.error(message);
      throw new Error(message);
    }

    const urls = matches.map((u) => {
      try {
        const parsed = new URL(u);
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
      } catch {
        return u.split("?")[0] ?? u;
      }
    });

    return uniqueInOrder(urls);
  }

  async fetchNews(args: {
    asOfDate: string;
    sincePublishedAt?: Date;
    maxUrls?: number;
  }): Promise<{ snapshot: MarketNewsSnapshot; totalUrls: number; keptUrls: number }> {
    const fetchedAt = new Date().toISOString();

    const urls = await this.fetchLatestVideoUrls();
    const capped = urls.slice(0, Math.max(1, args.maxUrls ?? 60));

    const sinceYmd = args.sincePublishedAt ? args.sincePublishedAt.toISOString().slice(0, 10) : null;

    const prefiltered = sinceYmd
      ? capped.filter((url) => {
          const ymd = parseCnbcVideoUrlYmd(url);
          return ymd === null ? true : ymd >= sinceYmd;
        })
      : capped;

    const articles = await mapWithConcurrency(prefiltered, 4, async (url): Promise<MarketNewsArticle | null> => {
      let meta: Awaited<ReturnType<typeof fetchArticleMeta>> | undefined;
      try {
        meta = await fetchArticleMeta(url, 2500);
      } catch {
        meta = undefined;
      }

      const title = meta?.title;
      if (!title) {
        return null;
      }

      const ymd = parseCnbcVideoUrlYmd(url);
      const fallbackDate = ymd ? new Date(`${ymd}T12:00:00Z`) : new Date(`${args.asOfDate}T12:00:00Z`);

      const published = meta?.publishedTime ? parseCnbcTimestamp(meta.publishedTime) : null;
      const publishedAtDate =
        published ?? (Number.isFinite(fallbackDate.getTime()) ? fallbackDate : new Date(`${args.asOfDate}T12:00:00Z`));
      if (args.sincePublishedAt && publishedAtDate.getTime() <= args.sincePublishedAt.getTime()) {
        return null;
      }

      const publisher = "CNBC";
      const relatedTickers: string[] = [];
      const topic = inferNewsTopic({ title, keywords: meta?.newsKeywords, tags: meta?.parselyTags });
      const hype = scoreNewsHype(title);
      const mainIdea = buildNewsMainIdea(title);
      const summary = buildNewsSummary({
        title,
        publisher,
        description: meta?.description,
        relatedTickers
      });

      return {
        id: buildCnbcVideoId(url),
        title,
        url,
        publisher,
        publishedAt: publishedAtDate.toISOString(),
        relatedTickers,
        topic,
        hype,
        mainIdea,
        summary
      };
    });

    const kept = articles.filter((a): a is MarketNewsArticle => a !== null);
    kept.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const snapshot: MarketNewsSnapshot = {
      symbol: "cnbc",
      provider: "cnbc",
      fetchedAt,
      asOfDate: args.asOfDate,
      articles: kept
    };

    return { snapshot, totalUrls: capped.length, keptUrls: kept.length };
  }
}
