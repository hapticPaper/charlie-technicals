import type { CnbcVideoArticle } from "../../market/types";

import type { CnbcVideoCard } from "./types";

export const DEFAULT_CNBC_TOPIC_LABEL = "general";

const PLACEHOLDER_TOPICS = new Set(["other", "unknown", "n/a", "na", "none", "null", "undefined"]);

function normalizeTopicKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sanitizeTopicLabel(value: string): string {
  const cleaned = normalizeTopicKey(value);
  if (!cleaned || PLACEHOLDER_TOPICS.has(cleaned)) {
    return DEFAULT_CNBC_TOPIC_LABEL;
  }

  return cleaned;
}

function inferTopicFromTitle(title: string): string {
  const t = title.toLowerCase();

  if (/\b(bitcoin|btc|crypto|ethereum|eth|solana|dogecoin)\b/.test(t)) {
    return "crypto";
  }

  if (
    /\b(fed|powell|rate|rates|interest\s+rate|inflation|cpi|pce|jobs\s+report|unemployment|treasury|bond|yield|yields|gdp)\b/.test(
      t
    )
  ) {
    return "rates";
  }

  if (/\b(earnings|quarter|guidance|revenue|profit|results|beat|miss)\b/.test(t)) {
    return "earnings";
  }

  if (/\b(ai|artificial\s+intelligence|chip|chips|semiconductor|nvidia|amd|intel|tsmc)\b/.test(t)) {
    return "ai/chips";
  }

  if (/\b(oil|crude|opec|gas\s+prices|energy)\b/.test(t)) {
    return "energy";
  }

  if (/\b(ev|electric\s+vehicle|autos|auto|car\s+makers|tesla)\b/.test(t)) {
    return "autos";
  }

  if (/\b(housing|mortgage|home\s+prices|real\s+estate|rent)\b/.test(t)) {
    return "housing";
  }

  if (/\b(bank|banks|credit\s+card|lending|jpmorgan|goldman|morgan\s+stanley|wells\s+fargo|citigroup)\b/.test(t)) {
    return "banks";
  }

  if (
    /\b(china|taiwan|russia|ukraine|israel|iran|gaza|middle\s+east|geopolitics|tariff|trade\s+war)\b/.test(t)
  ) {
    return "geopolitics";
  }

  if (/\b(pharma|drug|biotech|health\s+care|healthcare|vaccine)\b/.test(t)) {
    return "healthcare";
  }

  if (/\b(retail|consumer|spending|holiday\s+shopping|walmart|target|costco)\b/.test(t)) {
    return "consumer";
  }

  return "markets";
}

/**
* Returns a non-empty, normalized topic label for a CNBC video.
*
* - Never returns placeholder labels like `other`/`unknown`.
* - Falls back to a stable dimensionality reduction derived from the title.
*/
export function normalizeCnbcTopic(article: Pick<CnbcVideoArticle, "topic" | "title">): string {
  const raw = typeof article.topic === "string" ? normalizeTopicKey(article.topic) : "";

  if (raw && raw !== "date" && !PLACEHOLDER_TOPICS.has(raw)) {
    return sanitizeTopicLabel(raw);
  }

  const inferred = inferTopicFromTitle(article.title);
  const normalized = normalizeTopicKey(inferred);
  return sanitizeTopicLabel(normalized === "date" ? "markets" : normalized);
}

export function toCnbcVideoCard(article: CnbcVideoArticle): CnbcVideoCard {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    publishedAt: article.publishedAt,
    topic: normalizeCnbcTopic(article),
    symbol: article.symbol ?? null
  };
}
