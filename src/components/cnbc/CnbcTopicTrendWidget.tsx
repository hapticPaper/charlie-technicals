import { listCnbcVideoDates, readCnbcVideoArticles } from "../../market/storage";
import type { CnbcVideoArticle } from "../../market/types";

import type { CnbcVideosByDate, CnbcVideosByTopic } from "./types";
import { normalizeCnbcTopic, toCnbcVideoCard } from "./transform";
import { CnbcTopicTrendWidgetClient, type CnbcTopicTrendDatum } from "./CnbcTopicTrendWidgetClient";

// We intentionally show the last N non-empty days (days with at least one CNBC video),
// not the last N calendar days. This avoids long flat runs with zero data.
const MAX_NON_EMPTY_DAYS = 30;
// Cap how far back we scan, to keep the chart "recent" and avoid unbounded reads.
const MAX_SCAN_DAYS = MAX_NON_EMPTY_DAYS * 3;
const MAX_TOPICS = 8;
// Cap the number of most-recent videos we keep per (day, topic) for the overlay.
// Older videos beyond this cap are intentionally omitted to keep the page payload small.
const MAX_VIDEOS_PER_TOPIC_PER_DAY = 8;
const READ_BATCH_SIZE = 10;

function safePublishedTs(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

async function loadRecentNonEmptyDays(allDates: string[]): Promise<
  { days: Array<{ date: string; articles: CnbcVideoArticle[] }>; failedReads: number }
> {
  const days: Array<{ date: string; articles: CnbcVideoArticle[] }> = [];
  const failed: Array<{ date: string; message: string; name?: string; code?: unknown }> = [];
  const scanDates = [...allDates].sort().slice(-MAX_SCAN_DAYS).reverse();

  for (
    let offset = 0;
    offset < scanDates.length && days.length < MAX_NON_EMPTY_DAYS;
    offset += READ_BATCH_SIZE
  ) {
    const batch = scanDates.slice(offset, offset + READ_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((date) => readCnbcVideoArticles(date)));

    for (let idx = 0; idx < batch.length && days.length < MAX_NON_EMPTY_DAYS; idx += 1) {
      const date = batch[idx];
      const result = results[idx];

      if (result?.status === "fulfilled") {
        if (result.value.length > 0) {
          days.push({ date, articles: result.value });
        }
        continue;
      }

      const reason = result?.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      failed.push({
        date,
        message: message.length > 140 ? `${message.slice(0, 140)}…` : message,
        name: reason instanceof Error ? reason.name : undefined,
        code:
          typeof reason === "object" && reason !== null && "code" in reason
            ? (reason as { code?: unknown }).code
            : undefined
      });
    }
  }

  if (failed.length > 0) {
    const preview = failed
      .slice(0, 5)
      .map(({ date, name, code, message }) => {
        const meta = [name, code].filter(Boolean).join(":");
        return meta ? `${date} [${meta}] (${message})` : `${date} (${message})`;
      })
      .join(", ");
    const suffix = failed.length > 5 ? ", …" : "";
    console.error(`[home:cnbc] Failed reading CNBC videos for ${failed.length} day(s): ${preview}${suffix}`);
  }

  return { days, failedReads: failed.length };
}

export async function CnbcTopicTrendWidget() {
  const allDates = await listCnbcVideoDates();
  if (allDates.length === 0) {
    return null;
  }

  const { days, failedReads } = await loadRecentNonEmptyDays(allDates);
  if (days.length === 0) {
    return null;
  }

  const dayArticles = days.sort((a, b) => a.date.localeCompare(b.date));
  const latestDate = dayArticles[dayArticles.length - 1]?.date ?? null;

  const totals = new Map<string, number>();
  for (const { articles } of dayArticles) {
    for (const article of articles) {
      const topic = normalizeCnbcTopic(article);
      totals.set(topic, (totals.get(topic) ?? 0) + 1);
    }
  }

  const topTopics = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([topic]) => topic)
    .slice(0, MAX_TOPICS);
  const includedTopics = new Set(topTopics);

  const data: CnbcTopicTrendDatum[] = [];
  const videosByDate: CnbcVideosByDate = {};

  for (const { date, articles } of dayArticles) {
    const normalizedArticles = articles.map((article) => ({
      article,
      topic: normalizeCnbcTopic(article),
      publishedTs: safePublishedTs(article.publishedAt)
    }));

    const values: Record<string, number> = {};

    for (const entry of normalizedArticles) {
      if (includedTopics.has(entry.topic)) {
        values[entry.topic] = (values[entry.topic] ?? 0) + 1;
      }
    }

    for (const topic of topTopics) {
      values[topic] ??= 0;
    }

    data.push({ date, values });

    // The overlay shows the most recent videos per (day, topic), so topic selection always
    // lines up with the same `normalizeCnbcTopic()` keys used for chart aggregation.
    const targets = new Map<string, number>();
    let remaining = 0;
    for (const topic of topTopics) {
      const count = values[topic] ?? 0;
      const target = Math.min(count, MAX_VIDEOS_PER_TOPIC_PER_DAY);
      if (target > 0) {
        targets.set(topic, target);
        remaining += target;
      }
    }

    const grouped: CnbcVideosByTopic = {};

    const sorted = normalizedArticles.slice().sort((a, b) => b.publishedTs - a.publishedTs);

    // `remaining` tracks how many videos we still need globally across all topics.
    // We decrement it only when we successfully add a video to a topic bucket.
    for (const { article, topic } of sorted) {
      if (remaining === 0) {
        break;
      }

      const target = targets.get(topic);
      if (!target) {
        continue;
      }

      const bucket = (grouped[topic] ??= []);
      if (bucket.length >= target) {
        continue;
      }

      bucket.push(toCnbcVideoCard(article));
      remaining -= 1;
    }

    videosByDate[date] = grouped;
  }

  if (topTopics.length === 0) {
    return null;
  }

  return (
    <section style={{ marginTop: 28 }}>
      <h2>CNBC topic trends</h2>
      <p className="report-muted">
        <strong>Days:</strong> {dayArticles.length}
        {latestDate ? ` (latest ${latestDate})` : null}
        {failedReads > 0 ? ` (${failedReads} failed reads)` : null}
      </p>

      <CnbcTopicTrendWidgetClient data={data} topics={topTopics} videosByDate={videosByDate} />
    </section>
  );
}
