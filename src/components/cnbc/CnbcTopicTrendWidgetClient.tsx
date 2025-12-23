"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { TooltipContentProps } from "recharts";

import { useEffect, useMemo, useState } from "react";

import { CnbcVideoCards } from "./CnbcVideoCards";
import type { CnbcVideosByDate } from "./types";

export type CnbcTopicTrendDatum = {
  date: string;
  values: Record<string, number>;
};

type CnbcTopicTrendChartRow = Record<string, number | string>;

function toChartTopicKey(topic: string): string {
  return topic === "date" ? "topic_date" : topic;
}

const SERIES_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#22c55e",
  "#fb7185",
  "rgba(255, 255, 255, 0.35)"
];

function formatDateTick(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.slice(5);
  }

  return value;
}

type TooltipEntry = {
  name?: unknown;
  value?: unknown;
  color?: unknown;
};

function parseTooltipCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  return 0;
}

function parseTooltipTopic(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  return null;
}

function TopicTooltip(props: {
  active?: boolean;
  label?: unknown;
  payload?: readonly TooltipEntry[];
  selectedTopic: string | null;
  pinnedTopic: string | null;
  onSelect: (args: { date: string; topic: string }) => void;
}) {
  const date = typeof props.label === "string" ? props.label : null;

  const entries = useMemo(() => {
    return (props.payload ?? [])
      .map((entry) => {
        const topic = parseTooltipTopic(entry.name);
        if (!topic) {
          return null;
        }

        const count = parseTooltipCount(entry.value);
        return {
          topic,
          count,
          color: typeof entry.color === "string" ? entry.color : undefined
        };
      })
      .filter(
        (entry): entry is { topic: string; count: number; color: string | undefined } =>
          entry !== null && entry.count > 0
      );
  }, [props.payload]);

  const bestTopic = useMemo(() => {
    const best = entries.reduce<{ topic: string; count: number } | null>((acc, entry) => {
      if (!acc || entry.count > acc.count) {
        return { topic: entry.topic, count: entry.count };
      }
      return acc;
    }, null);

    return best?.topic ?? null;
  }, [entries]);

  useEffect(() => {
    if (!props.active || !date) {
      return;
    }
    if (props.selectedTopic || props.pinnedTopic) {
      return;
    }

    if (bestTopic) {
      props.onSelect({ date, topic: bestTopic });
    }
  }, [bestTopic, date, props.active, props.onSelect, props.pinnedTopic, props.selectedTopic]);

  if (!props.active || !date || entries.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: "var(--rp-surface)",
        border: "1px solid var(--rp-border)",
        color: "var(--rp-text)",
        padding: 10,
        borderRadius: 12
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{formatDateTick(date)}</div>
      <div style={{ display: "grid", gap: 4 }}>
        {entries.map((entry) => {
          const isSelected = props.selectedTopic === entry.topic;

          return (
            <button
              key={entry.topic}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onSelect({ date, topic: entry.topic });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px",
                borderRadius: 10,
                border: `1px solid ${isSelected ? "var(--rp-price)" : "transparent"}`,
                background: "transparent",
                color: "var(--rp-text)",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: entry.color ?? "var(--rp-muted)"
                }}
              />
              <span style={{ flex: "1 1 auto" }}>{entry.topic}</span>
              <span style={{ color: "var(--rp-muted)" }}>{entry.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CnbcTopicTrendWidgetClient(props: {
  data: CnbcTopicTrendDatum[];
  topics: string[];
  videosByDate: CnbcVideosByDate;
}) {
  // Recharts hydration workaround: render a placeholder until client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [preview, setPreview] = useState<{ date: string | null; topic: string | null }>({
    date: null,
    topic: null
  });
  const [pinned, setPinned] = useState<{ date: string | null; topic: string | null }>({
    date: null,
    topic: null
  });

  const chartTopics = useMemo(() => {
    return props.topics.map((topic) => ({ topic, chartKey: toChartTopicKey(topic) }));
  }, [props.topics]);

  const chartData = useMemo<CnbcTopicTrendChartRow[]>(() => {
    return props.data.map((row) => {
      const chartRow: CnbcTopicTrendChartRow = { date: row.date };
      for (const { topic, chartKey } of chartTopics) {
        chartRow[chartKey] = row.values[topic] ?? 0;
      }
      return chartRow;
    });
  }, [chartTopics, props.data]);

  const selectedDate = pinned.date ?? preview.date;
  const selectedTopic = pinned.topic ?? preview.topic;

  // Keep the overlay totals aligned with the chart aggregation for the selected date/topic.
  const selectedTotal = useMemo(() => {
    if (!selectedDate || !selectedTopic) {
      return null;
    }

    const row = props.data.find((entry) => entry.date === selectedDate);
    const total = row?.values[selectedTopic];
    return typeof total === "number" && Number.isFinite(total) ? total : null;
  }, [props.data, selectedDate, selectedTopic]);

  const activeVideos = useMemo(() => {
    if (!selectedDate || !selectedTopic) {
      return [];
    }

    const byDate = props.videosByDate[selectedDate];
    if (!byDate) {
      return [];
    }

    // Missing (date, topic) pairs are treated as "no videos" for that selection.
    return byDate[selectedTopic] ?? [];
  }, [props.videosByDate, selectedDate, selectedTopic]);

  const videoCountLabel = useMemo(() => {
    const shown = activeVideos.length;
    if (selectedTotal === null || selectedTotal <= 0) {
      return String(shown);
    }

    if (shown < selectedTotal) {
      return `${shown} of ${selectedTotal} (showing most recent)`;
    }

    return `${shown} of ${selectedTotal}`;
  }, [activeVideos.length, selectedTotal]);

  if (!mounted) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading CNBC topic trend chart"
        role="status"
        style={{
          width: "100%",
          height: 320,
          borderRadius: 12,
          border: "1px solid var(--rp-border)",
          background: "var(--rp-surface)"
        }}
      />
    );
  }

  return (
    <div>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer minWidth={0}>
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            onMouseMove={(state) => {
              const label = state.activeLabel;
              if (typeof label !== "string") {
                return;
              }

              setPreview((prev) => (prev.date === label ? prev : { ...prev, date: label }));
            }}
          >
            <CartesianGrid stroke="var(--rp-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fill: "var(--rp-muted)" }} />
            <YAxis tick={{ fill: "var(--rp-muted)" }} allowDecimals={false} />
            <Tooltip
              content={(tooltipProps: TooltipContentProps<number, string>) => (
                <TopicTooltip
                  active={tooltipProps.active}
                  label={tooltipProps.label}
                  payload={tooltipProps.payload as unknown as readonly TooltipEntry[] | undefined}
                  selectedTopic={selectedTopic}
                  pinnedTopic={pinned.topic}
                  onSelect={({ date, topic }) => {
                    setPreview((prev) => ({ ...prev, date, topic }));
                  }}
                />
              )}
            />
            <Legend />
            {chartTopics.map(({ topic, chartKey }, idx) => (
              <Area
                key={chartKey}
                type="monotone"
                dataKey={chartKey}
                name={topic}
                stackId="topics"
                stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                fillOpacity={0.35}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 14,
          borderRadius: 12,
          border: "1px solid var(--rp-border)",
          background: "var(--rp-surface)"
        }}
      >
        <p className="report-muted" style={{ marginTop: 0 }}>
          <strong>Hover</strong> a day, then <strong>click</strong> a topic in the tooltip to filter videos.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => {
              setPinned((prev) => {
                if (prev.date) {
                  return { ...prev, date: null };
                }

                return preview.date ? { ...prev, date: preview.date } : prev;
              });
            }}
            disabled={!preview.date && !pinned.date}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--rp-border)",
              background: "var(--rp-surface-2)",
              color: "var(--rp-text)",
              cursor: !preview.date && !pinned.date ? "not-allowed" : "pointer"
            }}
          >
            {pinned.date ? "Unpin date" : "Pin date"}
          </button>

          <button
            type="button"
            onClick={() => {
              setPinned((prev) => {
                if (prev.topic) {
                  return { ...prev, topic: null };
                }

                return preview.topic ? { ...prev, topic: preview.topic } : prev;
              });
            }}
            disabled={!preview.topic && !pinned.topic}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--rp-border)",
              background: "var(--rp-surface-2)",
              color: "var(--rp-text)",
              cursor: !preview.topic && !pinned.topic ? "not-allowed" : "pointer"
            }}
          >
            {pinned.topic ? "Unpin topic" : "Pin topic"}
          </button>

          <button
            type="button"
            onClick={() => {
              setPinned({ date: null, topic: null });
              setPreview({ date: null, topic: null });
            }}
            disabled={!preview.date && !preview.topic && !pinned.date && !pinned.topic}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--rp-border)",
              background: "transparent",
              color: "var(--rp-muted)",
              cursor: !preview.date && !preview.topic && !pinned.date && !pinned.topic ? "not-allowed" : "pointer"
            }}
          >
            Clear
          </button>
        </div>

        {selectedDate && selectedTopic ? (
          <p className="report-muted">
            <strong>Videos:</strong> {videoCountLabel} ({selectedDate} · {selectedTopic})
            {pinned.date || pinned.topic ? " (pinned)" : null}
          </p>
        ) : null}

        {selectedDate && selectedTopic ? <CnbcVideoCards videos={activeVideos} /> : <p className="report-muted">No selection.</p>}
      </div>
    </div>
  );
}
