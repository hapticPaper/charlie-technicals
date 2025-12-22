import { parseIsoDateYmd } from "./date";

const MAIN_IDEA_MAX_WORDS = 50;
const SUMMARY_MAX_WORDS = 500;
const SUMMARY_TAIL_BUDGET_WORDS = 30;
const DEFAULT_ARTICLE_META_TIMEOUT_MS = 2000;

function normalizeText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code)) {
        return "";
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      if (!Number.isFinite(code)) {
        return "";
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

function truncateWords(text: string, maxWords: number): string {
  const trimmed = normalizeText(text);
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) {
    return trimmed;
  }

  let truncated = words.slice(0, maxWords).join(" ");
  truncated = truncated.replace(/[\s.,;:]+$/u, "");
  return `${truncated}…`;
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

type HtmlMeta = {
  title?: string;
  description?: string;
  publishedTime?: string;
  newsKeywords?: string[];
  parselyTags?: string[];
};

function splitMetaList(value: string | undefined): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const items = value
    .split(",")
    .map((v) => normalizeText(v))
    .filter((v) => v !== "");

  if (items.length === 0) {
    return undefined;
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }

  return out;
}

function parseHtmlMeta(html: string): HtmlMeta {
  // Best-effort regex parser. It's OK if this fails quietly (we fall back to headline-only summaries).
  const safeHtml = html.slice(0, 250_000);
  const metas = safeHtml.match(/<meta\b[^>]*>/gi) ?? [];
  const map = new Map<string, string>();

  for (const tag of metas) {
    const nameMatch = tag.match(/\bname\s*=\s*["']([^"']+)["']/i);
    const propertyMatch = tag.match(/\bproperty\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);

    const content = contentMatch?.[1];
    if (!content) {
      continue;
    }
    const key = (propertyMatch?.[1] ?? nameMatch?.[1])?.toLowerCase();
    if (!key) {
      continue;
    }
    if (!map.has(key)) {
      map.set(key, content);
    }
  }

  const title =
    map.get("og:title") ??
    map.get("twitter:title") ??
    safeHtml.match(/<title\b[^>]*>([^<]+)<\/title>/i)?.[1];

  const description =
    map.get("og:description") ?? map.get("twitter:description") ?? map.get("description");

  const publishedTime = map.get("article:published_time") ?? map.get("parsely-pub-date");
  const newsKeywords = splitMetaList(map.get("news_keywords") ?? map.get("keywords"));
  const parselyTags = splitMetaList(map.get("parsely-tags"));

  return {
    title: typeof title === "string" ? normalizeText(title) : undefined,
    description: typeof description === "string" ? normalizeText(description) : undefined,
    publishedTime: typeof publishedTime === "string" ? normalizeText(publishedTime) : undefined,
    newsKeywords,
    parselyTags
  };
}

export async function fetchArticleMeta(
  url: string,
  timeoutMs = DEFAULT_ARTICLE_META_TIMEOUT_MS
): Promise<HtmlMeta> {
  const html = await fetchText(url, timeoutMs);
  return parseHtmlMeta(html);
}

function clampWords(value: string, maxWords: number): string {
  const words = value
    .replace(/[^a-z0-9\s-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function topicFromTags(tags: string[]): string | undefined {
  const drop = new Set(
    [
      "cnbc",
      "videos",
      "top videos",
      "cnbc tv",
      "pro",
      "investing club",
      "watch now",
      "video"
    ].map((t) => t.toLowerCase())
  );

  for (const raw of tags) {
    const normalized = raw
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const lc = normalized.toLowerCase();
    if (lc === "" || drop.has(lc)) {
      continue;
    }

    const candidate = clampWords(lc, 2);
    if (candidate !== "" && candidate.split(/\s+/).length <= 2) {
      return candidate;
    }
  }

  return undefined;
}

export function inferNewsTopic(args: {
  title: string;
  keywords?: string[];
  tags?: string[];
}): string | undefined {
  const title = args.title.toLowerCase();
  const haystack = [title, ...(args.keywords ?? []), ...(args.tags ?? [])].join(" ").toLowerCase();

  const rules: Array<{ pattern: RegExp; topic: string }> = [
    { pattern: /\b(bitcoin|crypto|ethereum|btc|etf)\b/, topic: "bitcoin" },
    { pattern: /\b(inflation|cpi|pce)\b/, topic: "inflation" },
    { pattern: /\b(rate cut|fed|powell|interest rate|fomc)\b/, topic: "rate cut" },
    { pattern: /\b(ai|artificial intelligence|openai|chatgpt|nvidia)\b/, topic: "ai" },
    { pattern: /\b(oil|crude|opec)\b/, topic: "oil" },
    { pattern: /\b(gold|silver|platinum|palladium)\b/, topic: "gold" },
    { pattern: /\b(china|beijing|xi jinping)\b/, topic: "china" },
    { pattern: /\b(tariff|trade war)\b/, topic: "tariff" },
    { pattern: /\b(earnings|guidance|quarter|q\d)\b/, topic: "earnings" }
  ];

  for (const rule of rules) {
    if (rule.pattern.test(haystack)) {
      return rule.topic;
    }
  }

  if (args.tags && args.tags.length > 0) {
    const tagTopic = topicFromTags(args.tags);
    if (tagTopic) {
      return tagTopic;
    }
  }

  if (args.keywords && args.keywords.length > 0) {
    const keywordTopic = topicFromTags(args.keywords);
    if (keywordTopic) {
      return keywordTopic;
    }
  }

  return undefined;
}

export function scoreNewsHype(title: string): number {
  const text = title.trim();
  const lower = text.toLowerCase();
  let score = 0;

  score += Math.min(20, (text.match(/!/g) ?? []).length * 10);
  score += Math.min(15, (text.match(/\$/g) ?? []).length * 5);
  score += /\b(trillion|billion|record|all-time|breakout|bubble|crash|plunge|surge|soar|slam)\b/.test(lower)
    ? 20
    : 0;
  score += /\b(urgent|breaking|stunning|huge|massive|shocking)\b/.test(lower) ? 15 : 0;
  score += /\b(beat|miss|guidance)\b/.test(lower) ? 10 : 0;

  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length >= 10) {
    const caps = letters.replace(/[^A-Z]/g, "").length;
    const ratio = caps / letters.length;
    if (ratio >= 0.5) {
      score += 20;
    } else if (ratio >= 0.3) {
      score += 10;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return score;
}

export function isRecentNews(args: { asOfDate: string; publishedAt: Date; maxAgeDays: number }): boolean {
  // Window is the last `maxAgeDays` calendar days (UTC), inclusive of `asOfDate`.
  const maxAgeDays = Math.max(1, Math.floor(args.maxAgeDays));
  const { year, month, day } = parseIsoDateYmd(args.asOfDate);
  const asOfStartUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const start = new Date(asOfStartUtc.getTime() - (maxAgeDays - 1) * 24 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  const ts = args.publishedAt.getTime();
  return ts >= start.getTime() && ts <= end.getTime();
}

export function buildNewsMainIdea(title: string): string {
  return truncateWords(title, MAIN_IDEA_MAX_WORDS);
}

export function buildNewsSummary(args: {
  title: string;
  publisher: string;
  description?: string;
  relatedTickers: string[];
}): string {
  const base = args.description
    ? `${args.publisher}: ${args.title}. ${args.description}`
    : `${args.publisher}: ${args.title.replace(/\.*$/, "")}.`;

  let summary = truncateWords(base, SUMMARY_MAX_WORDS - SUMMARY_TAIL_BUDGET_WORDS);
  if (args.relatedTickers.length > 0) {
    summary = `${summary} Related tickers mentioned: ${args.relatedTickers.join(", ")}.`;
  }

  return truncateWords(summary, SUMMARY_MAX_WORDS);
}

export function clampRelatedTickers(tickers: string[] | undefined, symbol: string): string[] {
  const out = new Set<string>();
  for (const t of tickers ?? []) {
    if (typeof t === "string" && t.trim() !== "") {
      out.add(t.trim().toUpperCase());
    }
  }
  out.delete(symbol.toUpperCase());
  return Array.from(out).sort();
}
