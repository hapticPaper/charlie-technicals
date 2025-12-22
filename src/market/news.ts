import { parseIsoDateYmd } from "./date";

const MAIN_IDEA_MAX_WORDS = 50;
const SUMMARY_MAX_WORDS = 500;
const SUMMARY_TAIL_BUDGET_WORDS = 30;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateWords(text: string, maxWords: number): string {
  const trimmed = normalizeText(text);
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) {
    return trimmed;
  }

  return `${words.slice(0, maxWords).join(" ")}…`;
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
};

function parseHtmlMeta(html: string): HtmlMeta {
  // Best-effort regex parser. It's OK if this fails quietly (we fall back to headline-only summaries).
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
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
    html.match(/<title\b[^>]*>([^<]+)<\/title>/i)?.[1];

  const description =
    map.get("og:description") ?? map.get("twitter:description") ?? map.get("description");

  return {
    title: typeof title === "string" ? normalizeText(title) : undefined,
    description: typeof description === "string" ? normalizeText(description) : undefined
  };
}

export async function fetchArticleMeta(url: string): Promise<HtmlMeta> {
  const html = await fetchText(url, 4000);
  return parseHtmlMeta(html.slice(0, 250_000));
}

export function isRecentNews(args: { asOfDate: string; publishedAt: Date; maxAgeDays: number }): boolean {
  // Window is the last `maxAgeDays` calendar days (UTC), inclusive of `asOfDate`.
  const { year, month, day } = parseIsoDateYmd(args.asOfDate);
  const asOfStartUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const start = new Date(asOfStartUtc.getTime() - (args.maxAgeDays - 1) * 24 * 60 * 60 * 1000);
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
