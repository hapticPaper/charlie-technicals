"use client";

import type { CSSProperties } from "react";

import { DEFAULT_CNBC_TOPIC_LABEL } from "./transform";
import type { CnbcVideoCard } from "./types";

const warnedTopicLabels = new Set<string>();

function safeTimestamp(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function formatPublishedAt(value: string): string {
  const ts = safeTimestamp(value);
  if (!ts) {
    return "";
  }

  return new Date(ts).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function topicBadgeLabel(topic: string): string {
  const cleaned = topic.trim();
  const normalized = cleaned.toLowerCase();

  const isPlaceholder =
    !cleaned ||
    normalized === "other" ||
    normalized === "unknown" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized === "null" ||
    normalized === "undefined";

  if (!isPlaceholder) {
    return cleaned;
  }

  if (process.env.NODE_ENV !== "production") {
    const key = normalized || "<empty>";
    if (!warnedTopicLabels.has(key)) {
      warnedTopicLabels.add(key);
      console.warn("[CnbcVideoCards] Unexpected topic label", { topic });
    }
  }

  return DEFAULT_CNBC_TOPIC_LABEL;
}

const cardStyle: CSSProperties = {
  display: "block",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--rp-border)",
  background: "var(--rp-surface)",
  textDecoration: "none"
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.25,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical"
};

export function CnbcVideoCards(props: {
  videos: CnbcVideoCard[];
  max?: number;
  showTopic?: boolean;
}) {
  const limit = typeof props.max === "number" && Number.isFinite(props.max) ? Math.max(0, props.max) : 8;
  const items = props.videos.slice(0, limit);

  if (items.length === 0) {
    return <p className="report-muted">No videos.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((video) => {
        const topic = props.showTopic ? topicBadgeLabel(video.topic) : null;
        const publishedLabel = formatPublishedAt(video.publishedAt);

        return (
          <a key={video.id} href={video.url} target="_blank" rel="noreferrer" style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 6
              }}
            >
              {publishedLabel ? <span className="report-muted">{publishedLabel}</span> : <span />}
              {topic ? (
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--rp-border)",
                    background: "var(--rp-surface-2)",
                    color: "var(--rp-muted)",
                    whiteSpace: "nowrap"
                  }}
                >
                  {topic}
                </span>
              ) : null}
            </div>

            <div style={titleStyle}>{video.title}</div>
          </a>
        );
      })}
    </div>
  );
}
