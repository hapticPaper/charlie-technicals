"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { useEffect, useMemo, useState } from "react";

import { CnbcVideoCards } from "../cnbc/CnbcVideoCards";
import type { CnbcVideoCard } from "../cnbc/types";

export type CnbcTopicHypeDatum = {
  topic: string;
  count: number;
  avgHype: number;
  videos: CnbcVideoCard[];
};

export function CnbcVideoWidgetClient(props: {
  data: CnbcTopicHypeDatum[];
}) {
  // Recharts hydration workaround: render a placeholder until client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const activeDatum = useMemo(() => {
    if (!activeTopic) {
      return null;
    }

    return props.data.find((datum) => datum.topic === activeTopic) ?? null;
  }, [activeTopic, props.data]);

  if (!mounted) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading CNBC video topics chart"
        role="status"
        style={{
          width: "100%",
          height: 260,
          borderRadius: 12,
          border: "1px solid var(--rp-border)",
          background: "var(--rp-surface)"
        }}
      />
    );
  }

  return (
    <div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer minWidth={0}>
          <BarChart
            data={props.data}
            margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            onMouseMove={(evt) => {
              const topic = (evt as { activePayload?: Array<{ payload?: { topic?: unknown } }> } | null)?.activePayload?.[0]
                ?.payload?.topic;
              if (typeof topic === "string") {
                setActiveTopic(topic);
              }
            }}
            onMouseLeave={() => setActiveTopic(null)}
          >
            <CartesianGrid stroke="var(--rp-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="topic" tick={{ fill: "var(--rp-muted)" }} />
            <YAxis yAxisId="left" tick={{ fill: "var(--rp-muted)" }} allowDecimals={false} />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: "var(--rp-muted)" }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--rp-surface)",
                border: "1px solid var(--rp-border)",
                color: "var(--rp-text)"
              }}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="count" name="videos" fill="var(--rp-price)" />
            <Bar yAxisId="right" dataKey="avgHype" name="avg hype" fill="var(--rp-warn)" />
          </BarChart>
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
          <strong>Hover a topic</strong> to see the CNBC videos.
        </p>

        {activeDatum ? (
          <p className="report-muted">
            <strong>Videos:</strong> {activeDatum.videos.length} (topic: {activeDatum.topic})
          </p>
        ) : null}

        {activeDatum ? <CnbcVideoCards videos={activeDatum.videos} /> : <p className="report-muted">No topic selected.</p>}
      </div>
    </div>
  );
}
