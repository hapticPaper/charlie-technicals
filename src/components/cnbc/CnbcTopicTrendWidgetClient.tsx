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

import { useEffect, useMemo, useState } from "react";

import { CnbcVideoCards } from "./CnbcVideoCards";
import type { CnbcVideoCard } from "./types";

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

export function CnbcTopicTrendWidgetClient(props: {
  data: CnbcTopicTrendDatum[];
  topics: string[];
  videosByDate: Record<string, CnbcVideoCard[]>;
}) {
  // Recharts hydration workaround: render a placeholder until client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [activeDate, setActiveDate] = useState<string | null>(null);

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

  const activeVideos = useMemo(() => {
    if (!activeDate) {
      return [];
    }

    return props.videosByDate[activeDate] ?? [];
  }, [activeDate, props.videosByDate]);

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
            onMouseMove={(evt) => {
              const label = evt?.activeLabel;
              if (typeof label === "string") {
                setActiveDate((prev) => (prev === label ? prev : label));
              }
            }}
            onMouseLeave={() => setActiveDate(null)}
          >
            <CartesianGrid stroke="var(--rp-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fill: "var(--rp-muted)" }} />
            <YAxis tick={{ fill: "var(--rp-muted)" }} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                background: "var(--rp-surface)",
                border: "1px solid var(--rp-border)",
                color: "var(--rp-text)"
              }}
              labelFormatter={formatDateTick}
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
          <strong>Hover a day</strong> to see the CNBC videos.
        </p>

        {activeDate ? (
          <p className="report-muted">
            <strong>Videos:</strong> {activeVideos.length} (on {activeDate})
          </p>
        ) : null}

        {activeDate ? (
          <CnbcVideoCards videos={activeVideos} showTopic />
        ) : (
          <p className="report-muted">No day selected.</p>
        )}
      </div>
    </div>
  );
}
