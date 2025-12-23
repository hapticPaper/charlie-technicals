"use client";

import type { CSSProperties } from "react";

import { DEFAULT_CNBC_TOPIC_LABEL } from "./transform";
import type { CnbcVideoCard } from "./types";

const CNBC_TIME_ZONE = "America/New_York";

function safeTimestamp(value: string): number | null {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

type PublishedAtLabelMode = "time" | "day" | "dayWithYear";

function ymdKeyInTz(ts: number): string | null {
  if (!Number.isFinite(ts)) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CNBC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(ts);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function getPublishedAtLabelMode(timestamps: Array<number | null>): PublishedAtLabelMode {
  // If all timestamps are the same calendar day in the CNBC time zone, show times.
  // If multiple days but all within the same year, show MM/DD.
  // If dates span multiple years, show MM/DD/YYYY.
  const valid = timestamps.filter((ts): ts is number => typeof ts === "number" && Number.isFinite(ts));
  const dayKeys = valid.map((ts) => ymdKeyInTz(ts)).filter((key): key is string => Boolean(key));
  if (dayKeys.length === 0) {
    return "day";
  }

  const uniqueDays = new Set(dayKeys);
  if (uniqueDays.size === 1) {
    return "time";
  }

  const uniqueYears = new Set(Array.from(uniqueDays, (k) => k.slice(0, 4)));
  if (uniqueYears.size === 1) {
    return "day";
  }

  return "dayWithYear";
}

function formatPublishedAt(value: string, mode: PublishedAtLabelMode): string {
  const ts = safeTimestamp(value);
  if (ts === null) {
    return "";
  }

  const base: Intl.DateTimeFormatOptions = { timeZone: CNBC_TIME_ZONE };

  if (mode === "time") {
    return new Intl.DateTimeFormat("en-US", {
      ...base,
      hour: "2-digit",
      minute: "2-digit"
    }).format(ts);
  }

  if (mode === "day") {
    return new Intl.DateTimeFormat("en-US", {
      ...base,
      month: "2-digit",
      day: "2-digit"
    }).format(ts);
  }

  return new Intl.DateTimeFormat("en-US", {
    ...base,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(ts);
}

function topicBadgeLabel(topic: string): string {
  // `CnbcVideoCard.topic` is expected to already be user-presentable via `normalizeCnbcTopic`.
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

  return isPlaceholder ? DEFAULT_CNBC_TOPIC_LABEL : cleaned;
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

  // Pick the label granularity based on the range of videos the user is seeing.
  const publishedAtMode = getPublishedAtLabelMode(
    items.map((video) => safeTimestamp(video.publishedAt))
  );

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
