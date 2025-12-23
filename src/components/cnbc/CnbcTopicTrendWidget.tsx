import { listCnbcVideoDates, readCnbcVideoArticles } from "../../market/storage";
import type { CnbcVideoArticle } from "../../market/types";

import type { CnbcVideoCard } from "./types";
import { CnbcTopicTrendWidgetClient, type CnbcTopicTrendDatum } from "./CnbcTopicTrendWidgetClient";

const MAX_NON_EMPTY_DAYS = 30;
const MAX_TOPICS = 8;
const MAX_VIDEOS_PER_DAY = 10;

function safePublishedTs(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeTopic(topic: string | undefined): string {
  const cleaned = (topic ?? "other").trim().toLowerCase();
  return cleaned === "" ? "other" : cleaned;
}

function toVideoCard(article: CnbcVideoArticle): CnbcVideoCard {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    publishedAt: article.publishedAt,
    topic: article.topic ? normalizeTopic(article.topic) : null,
    symbol: article.symbol ?? null
  };
}

async function loadRecentNonEmptyDays(allDates: string[]): Promise<
  Array<{ date: string; articles: CnbcVideoArticle[] }>
> {
  const dayArticles: Array<{ date: string; articles: CnbcVideoArticle[] }> = [];

  // Scan newest-to-oldest until we have N non-empty days. Fetch in small concurrent batches.
  const BATCH_SIZE = 10;
  let end = allDates.length;
  while (end > 0 && dayArticles.length < MAX_NON_EMPTY_DAYS) {
    const start = Math.max(0, end - BATCH_SIZE);
    const dates = allDates.slice(start, end);
    end = start;

    const results = await Promise.allSettled(dates.map((date) => readCnbcVideoArticles(date)));
    for (let idx = dates.length - 1; idx >= 0 && dayArticles.length < MAX_NON_EMPTY_DAYS; idx -= 1) {
      const date = dates[idx];
      const result = results[idx];

      if (!result) {
        continue;
      }

      if (result.status === "fulfilled") {
        if (result.value.length > 0) {
          dayArticles.push({ date, articles: result.value });
        }
        continue;
      }

      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`[home:cnbc] Failed reading CNBC videos for ${date}: ${message}`);
    }
  }

  return dayArticles;
}

export async function CnbcTopicTrendWidget() {
  const allDates = await listCnbcVideoDates();
  if (allDates.length === 0) {
    return null;
  }

  const dayArticles = await loadRecentNonEmptyDays(allDates);

  if (dayArticles.length === 0) {
    return null;
  }

  dayArticles.sort((a, b) => a.date.localeCompare(b.date));
  const latestDate = dayArticles[dayArticles.length - 1]?.date ?? null;

  const totals = new Map<string, number>();
  for (const { articles } of dayArticles) {
    for (const article of articles) {
      const topic = normalizeTopic(article.topic);
      totals.set(topic, (totals.get(topic) ?? 0) + 1);
    }
  }

  const topTopics = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([topic]) => topic)
    .slice(0, MAX_TOPICS);
  const includedTopics = new Set(topTopics);

  const data: CnbcTopicTrendDatum[] = [];
  const videosByDate: Record<string, CnbcVideoCard[]> = {};
  let hasOther = false;

  for (const { date, articles } of dayArticles) {
    const row: CnbcTopicTrendDatum = { date };
    let other = 0;

    for (const article of articles) {
      const topic = normalizeTopic(article.topic);
      if (includedTopics.has(topic)) {
        const prev = typeof row[topic] === "number" ? row[topic] : 0;
        row[topic] = prev + 1;
      } else {
        other += 1;
      }
    }

    if (other > 0) {
      row.other = other;
      hasOther = true;
    }

    for (const topic of topTopics) {
      row[topic] ??= 0;
    }

    data.push(row);

    videosByDate[date] = articles
      .slice()
      .map((article) => ({ article, ts: safePublishedTs(article.publishedAt) }))
      .sort((a, b) => b.ts - a.ts)
      .map((entry) => toVideoCard(entry.article))
      .slice(0, MAX_VIDEOS_PER_DAY);
  }

  const topics = hasOther ? [...topTopics, "other"] : topTopics;
  if (topics.length === 0) {
    return null;
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h2>CNBC topic trends</h2>
      <p className="report-muted">
        <strong>Days:</strong> {dayArticles.length}
        {latestDate ? ` (latest ${latestDate})` : null}
      </p>

      <CnbcTopicTrendWidgetClient data={data} topics={topics} videosByDate={videosByDate} />
    </section>
  );
}
