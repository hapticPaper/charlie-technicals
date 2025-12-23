import { readCnbcVideoArticles } from "../../market/reportStorage";
import type { CnbcVideoArticle } from "../../market/types";

import { CnbcVideoWidgetClient, type CnbcTopicHypeDatum } from "./CnbcVideoWidgetClient";

const MAX_CNBC_WIDGET_ARTICLES = 500;

type CnbcVideoArticles = CnbcVideoArticle[];

function buildTopicData(articles: CnbcVideoArticles): CnbcTopicHypeDatum[] {
  function safePublishedTs(value: string): number {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : 0;
  }

  // Sort newest-first so we only consider the most recent CNBC videos.
  const sorted = articles
    .map((article) => ({ article, ts: safePublishedTs(article.publishedAt) }))
    .sort((a, b) => b.ts - a.ts)
    .map((entry) => entry.article);
  const counts = new Map<string, { count: number; hypeSum: number }>();

  for (const article of sorted.slice(0, MAX_CNBC_WIDGET_ARTICLES)) {
    const topic = (article.topic ?? "other").trim().toLowerCase();
    if (topic === "") {
      continue;
    }
    const hype = typeof article.hype === "number" && Number.isFinite(article.hype) ? article.hype : 0;

    const existing = counts.get(topic) ?? { count: 0, hypeSum: 0 };
    existing.count += 1;
    existing.hypeSum += hype;
    counts.set(topic, existing);
  }

  return Array.from(counts.entries())
    .map(([topic, v]) => ({
      topic,
      count: v.count,
      avgHype: v.count > 0 ? Math.round((v.hypeSum / v.count) * 10) / 10 : 0
    }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 10);
}

export async function CnbcVideoWidget(props: { date: string }) {
  let articles: CnbcVideoArticles;
  try {
    articles = await readCnbcVideoArticles(props.date);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }

  if (articles.length === 0) {
    return null;
  }

  const articleDates = Array.from(new Set(articles.map((a) => a.asOfDate).filter(Boolean)));
  if (articleDates.length !== 1) {
    console.error("[CnbcVideoWidget] inconsistent asOfDate values", {
      requestedDate: props.date,
      articleDates
    });
    return null;
  }
  if (articleDates[0] !== props.date) {
    console.error("[CnbcVideoWidget] asOfDate mismatch", {
      requestedDate: props.date,
      asOfDate: articleDates[0]
    });
    return null;
  }
  const [asOfDate] = articleDates;
  if (!asOfDate) {
    return null;
  }
  const data = buildTopicData(articles);
  if (data.length === 0) {
    return null;
  }

  return (
    <section>
      <h2>CNBC video topics</h2>
      <p className="report-muted">
        <strong>Videos:</strong> {articles.length} (as of {asOfDate})
      </p>
      <CnbcVideoWidgetClient data={data} />
    </section>
  );
}
