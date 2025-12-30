import type { MarketNewsArticle } from "./types";

export function normalizeNewsArticleForMerge(article: MarketNewsArticle): MarketNewsArticle {
  const normalizedThumbnailUrl =
    typeof article.thumbnailUrl === "string"
      ? article.thumbnailUrl.trim() !== ""
        ? article.thumbnailUrl.trim()
        : null
      : article.thumbnailUrl;

  return {
    ...article,
    thumbnailUrl: normalizedThumbnailUrl,
    relatedTickers: Array.from(new Set(article.relatedTickers))
  };
}

export function mergeNewsArticles(
  existing: MarketNewsArticle,
  incoming: MarketNewsArticle
): {
  merged: MarketNewsArticle;
  changed: boolean;
} {
  const normalizedIncoming = normalizeNewsArticleForMerge(incoming);
  const existingTopic =
    typeof existing.topic === "string" && existing.topic.trim() !== "" ? existing.topic : undefined;
  const incomingTopic =
    typeof normalizedIncoming.topic === "string" && normalizedIncoming.topic.trim() !== ""
      ? normalizedIncoming.topic
      : undefined;

  const merged: MarketNewsArticle = {
    ...normalizedIncoming,
    thumbnailUrl: normalizedIncoming.thumbnailUrl ?? existing.thumbnailUrl,
    // Preserve any previously-enriched topic values (they may be human-curated or hand-corrected).
    topic: existingTopic ?? incomingTopic,
    hype: normalizedIncoming.hype ?? existing.hype,
    relatedTickers:
      normalizedIncoming.relatedTickers.length > 0 ? normalizedIncoming.relatedTickers : existing.relatedTickers
  };

  const changed = JSON.stringify(merged) !== JSON.stringify(existing);
  return { merged, changed };
}
