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

import { useEffect, useState } from "react";

export type CnbcTopicHypeDatum = {
  topic: string;
  count: number;
  avgHype: number;
};

export function CnbcVideoWidgetClient(props: {
  data: CnbcTopicHypeDatum[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
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
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer minWidth={0}>
        <BarChart data={props.data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid stroke="var(--rp-grid)" strokeDasharray="3 3" />
          <XAxis dataKey="topic" tick={{ fill: "var(--rp-muted)" }} />
          <YAxis yAxisId="left" tick={{ fill: "var(--rp-muted)" }} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: "var(--rp-muted)" }} />
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
  );
}
