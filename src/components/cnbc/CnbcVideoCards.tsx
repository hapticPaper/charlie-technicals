"use client";

import type { CSSProperties } from "react";

import type { CnbcVideoCard } from "./types";

const CNBC_TIME_ZONE = "America/New_York";

function safeTimestamp(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

type PublishedAtLabelMode = "time" | "day" | "dayWithYear";

function getPublishedAtLabelMode(timestamps: number[]): PublishedAtLabelMode {
  if (timestamps.length === 0) {
    return "day";
  }

  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) {
    return "day";
  }

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CNBC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const minKey = fmt.format(minTs);
  const maxKey = fmt.format(maxTs);
  if (minKey === maxKey) {
    return "time";
  }

  const minYear = minKey.split("/")[2];
  const maxYear = maxKey.split("/")[2];
  if (minYear && maxYear && minYear === maxYear) {
    return "day";
  }

  return "dayWithYear";
}

function formatPublishedAt(value: string, mode: PublishedAtLabelMode): string {
  const ts = safeTimestamp(value);
  if (!ts) {
    return "";
  }

  if (mode === "time") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: CNBC_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit"
    }).format(ts);
  }

  if (mode === "day") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: CNBC_TIME_ZONE,
      month: "2-digit",
      day: "2-digit"
    }).format(ts);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: CNBC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(ts);
}

function topicBadgeLabel(topic: string): string {
  return topic.trim();
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
  const publishedAtMode = getPublishedAtLabelMode(items.map((video) => safeTimestamp(video.publishedAt)).filter(Boolean));

  if (items.length === 0) {
    return <p className="report-muted">No videos.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((video) => {
        const topic = props.showTopic ? topicBadgeLabel(video.topic) : null;
        const publishedLabel = formatPublishedAt(video.publishedAt, publishedAtMode);

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
