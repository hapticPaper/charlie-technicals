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
import { getRechartsInitialDimension } from "../report/rechartsConfig";

export type CnbcTopicTrendDatum = {
  date: string;
  values: Record<string, number>;
};

type CnbcTopicTrendChartRow = Record<string, number | string>;

type YAxisMode = "log2" | "linear";

// The server intentionally sends a larger topic pool so we can still fill this chart
// when excluding "markets".
const MAX_VISIBLE_TOPICS = 8;

function toChartTopicKey(topic: string): string {
  return topic === "date" ? "topic_date" : topic;
}

function toRawChartKey(chartKey: string): string {
  // Reserved prefix used for tooltip counts.
  return `raw_${chartKey}`;
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

const warnedTooltipRawKeys = new Set<string>();

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
  dataKey?: string | number;
  payload?: Record<string, unknown>;
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

function formatLog2Tick(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  const raw = Math.pow(2, value) - 1;
  if (!Number.isFinite(raw)) {
    return "";
  }

  const rounded = Math.round(raw);
  return String(rounded);
}

function TopicTooltip(props: {
  active?: boolean;
  label?: unknown;
  payload?: readonly TooltipEntry[];
  yAxisMode: YAxisMode;
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

        const chartKey = typeof entry.dataKey === "string" ? entry.dataKey : null;
        const row = entry.payload ?? null;
        const raw = chartKey && row ? row[toRawChartKey(chartKey)] : undefined;
        const hasRaw = typeof raw === "number" && Number.isFinite(raw);
        if (props.yAxisMode === "log2" && !hasRaw) {
          if (process.env.NODE_ENV !== "production") {
            const key = `${topic}::${chartKey ?? "unknown"}`;
            if (!warnedTooltipRawKeys.has(key)) {
              warnedTooltipRawKeys.add(key);
              console.warn(`[home:cnbc] Missing raw tooltip value for ${key}`);
            }
          }

          return null;
        }

        const count = parseTooltipCount(hasRaw ? raw : entry.value);
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

  const [yAxisMode, setYAxisMode] = useState<YAxisMode>("log2");
  const [includeMarkets, setIncludeMarkets] = useState(true);

  const [preview, setPreview] = useState<{ date: string | null; topic: string | null }>({
    date: null,
    topic: null
  });
  const [pinned, setPinned] = useState<{ date: string | null; topic: string | null }>({
    date: null,
    topic: null
  });

  const visibleTopics = useMemo(() => {
    const candidates = includeMarkets ? props.topics : props.topics.filter((topic) => topic !== "markets");
    return candidates.slice(0, MAX_VISIBLE_TOPICS);
  }, [includeMarkets, props.topics]);

  useEffect(() => {
    const allowed = new Set(visibleTopics);
    setPreview((prev) => (prev.topic && !allowed.has(prev.topic) ? { ...prev, topic: null } : prev));
    setPinned((prev) => (prev.topic && !allowed.has(prev.topic) ? { ...prev, topic: null } : prev));
  }, [visibleTopics]);

  const chartTopics = useMemo(() => {
    return visibleTopics.map((topic) => {
      const chartKey = toChartTopicKey(topic);
      return { topic, chartKey, rawKey: toRawChartKey(chartKey) };
    });
  }, [visibleTopics]);

  const chartData = useMemo<CnbcTopicTrendChartRow[]>(() => {
    return props.data.map((row) => {
      const chartRow: CnbcTopicTrendChartRow = { date: row.date };

      let total = 0;
      for (const { topic, rawKey } of chartTopics) {
        const raw = row.values[topic] ?? 0;
        total += raw;
        chartRow[rawKey] = raw;
      }

      // In log2 mode, we want the stacked total height for a day to be log2(total + 1) while
      // preserving each topic's share of that total. This is why we apply a per-row scale
      // factor instead of taking log2() per series.
      const logScale = total > 0 ? Math.log2(total + 1) / total : 0;

      for (const { rawKey, chartKey } of chartTopics) {
        const raw = chartRow[rawKey];
        const value = typeof raw === "number" ? raw : 0;
        chartRow[chartKey] = yAxisMode === "linear" ? value : value * logScale;
      }

      return chartRow;
    });
  }, [chartTopics, props.data, yAxisMode]);

  const log2Ticks = useMemo(() => {
    if (yAxisMode !== "log2") {
      return null;
    }

    let maxTotal = 0;
    for (const row of props.data) {
      let total = 0;
      for (const { topic } of chartTopics) {
        total += row.values[topic] ?? 0;
      }
      maxTotal = Math.max(maxTotal, total);
    }

    const maxTick = Math.ceil(Math.log2(maxTotal + 1));
    return Array.from({ length: maxTick + 1 }, (_, idx) => idx);
  }, [chartTopics, props.data, yAxisMode]);

  const log2DomainMax = log2Ticks ? log2Ticks[log2Ticks.length - 1] ?? 0 : 0;

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
      <div className="rpSplitLayout">
        <div className="rpSplitMain">
          <div
            aria-busy="true"
            aria-label="Loading CNBC topic trend chart"
            role="status"
            className="rpPanelSkeleton"
            style={{ height: 320 }}
          />
        </div>
        <div className="rpSplitSide">
          <div
            aria-busy="true"
            aria-label="Loading CNBC topic videos"
            role="status"
            className="rpPanelSkeleton"
            style={{ height: 320 }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rpSplitLayout">
      <div className="rpSplitMain">
        <div className="rpPanelSurface">
          <div className="rpToolbar">
            <button
              type="button"
              onClick={() => {
                setYAxisMode((prev) => (prev === "log2" ? "linear" : "log2"));
              }}
              className="rpToolbarButton"
            >
              Y axis: {yAxisMode}
            </button>

            <button
              type="button"
              onClick={() => {
                setIncludeMarkets((prev) => !prev);
              }}
              className="rpToolbarButton"
            >
              Categories: {includeMarkets ? "all" : 'all except "markets"'}
            </button>
          </div>

          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer minWidth={0} initialDimension={getRechartsInitialDimension()}>
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
                <YAxis
                  tick={{ fill: "var(--rp-muted)" }}
                  allowDecimals={false}
                  domain={yAxisMode === "log2" ? [0, log2DomainMax] : undefined}
                  ticks={log2Ticks ?? undefined}
                  tickFormatter={yAxisMode === "log2" ? formatLog2Tick : undefined}
                />
                <Tooltip
                  content={(tooltipProps: TooltipContentProps<number, string>) => (
                    <TopicTooltip
                      active={tooltipProps.active}
                      label={tooltipProps.label}
                      payload={tooltipProps.payload as unknown as readonly TooltipEntry[] | undefined}
                      yAxisMode={yAxisMode}
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
        </div>
      </div>

      <div className="rpSplitSide">
        <div className="rpPanelSurface rpPanelSurfaceSide">
          <p className="report-muted" style={{ marginTop: 0 }}>
            <strong>Hover</strong> a day, then <strong>click</strong> a topic in the tooltip to filter videos.
          </p>

          <div className="rpToolbar">
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
              className="rpToolbarButton"
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
              className="rpToolbarButton"
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
              className="rpToolbarButton rpToolbarButtonSecondary"
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
    </div>
  );
}
