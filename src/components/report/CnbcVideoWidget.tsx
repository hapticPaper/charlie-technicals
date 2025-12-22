import { getNewsPath, readJson } from "../../market/storage";
import type { MarketNewsSnapshot } from "../../market/types";

import { CnbcVideoWidgetClient, type CnbcTopicHypeDatum } from "./CnbcVideoWidgetClient";

function buildTopicData(snapshot: MarketNewsSnapshot): CnbcTopicHypeDatum[] {
  const counts = new Map<string, { count: number; hypeSum: number; hypeCount: number }>();

  for (const article of snapshot.articles) {
    const topic = (article.topic ?? "other").toLowerCase();
    const hype = typeof article.hype === "number" && Number.isFinite(article.hype) ? article.hype : 0;

    const existing = counts.get(topic) ?? { count: 0, hypeSum: 0, hypeCount: 0 };
    existing.count += 1;
    existing.hypeSum += hype;
    existing.hypeCount += 1;
    counts.set(topic, existing);
  }

  return Array.from(counts.entries())
    .map(([topic, v]) => ({
      topic,
      count: v.count,
      avgHype: v.hypeCount > 0 ? Math.round((v.hypeSum / v.hypeCount) * 10) / 10 : 0
    }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 10);
}

export async function CnbcVideoWidget(props: { date: string }) {
  let snapshot: MarketNewsSnapshot;
  try {
    snapshot = await readJson<MarketNewsSnapshot>(getNewsPath(props.date, "cnbc"));
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

  if (snapshot.articles.length === 0) {
    return null;
  }

  const data = buildTopicData(snapshot);
  if (data.length === 0) {
    return null;
  }

  return (
    <section>
      <h2>CNBC video topics</h2>
      <p className="report-muted">
        <strong>Videos:</strong> {snapshot.articles.length} (as of {snapshot.asOfDate})
      </p>
      <CnbcVideoWidgetClient data={data} />
    </section>
  );
}
