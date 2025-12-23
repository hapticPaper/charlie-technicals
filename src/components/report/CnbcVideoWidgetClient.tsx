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
import { getRechartsInitialDimension } from "./rechartsConfig";

type BarHoverPayload = {
  payload?: { topic?: unknown };
};

function getClickedBarTopic(payload: unknown): string | null {
  const topic = (payload as BarHoverPayload | undefined)?.payload?.topic;
  return typeof topic === "string" ? topic : null;
}

function getActiveBarTopic(evt: unknown): string | null {
  if (!evt || typeof evt !== "object") {
    return null;
  }

  const activePayload = (evt as { activePayload?: unknown }).activePayload;
  if (!Array.isArray(activePayload)) {
    return null;
  }

  // Recharts can emit multiple payload entries; pick the first one that carries a topic label.
  for (const entry of activePayload) {
    // `activePayload` can contain multiple series entries for the same hovered bar;
    // we just need a stable topic label.
    const topic = (entry as BarHoverPayload | undefined)?.payload?.topic;
    if (typeof topic === "string") {
      return topic;
    }
  }

  return null;
}

export type CnbcTopicHypeDatum = {
  topic: string;
  count: number;
  avgHype: number;
  videos: CnbcVideoCard[];
};

export function CnbcVideoWidgetClient(props: { data: CnbcTopicHypeDatum[] }) {
  const initialDimension = useMemo(getRechartsInitialDimension, []);

  // Recharts hydration workaround: render a placeholder until client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [previewTopic, setPreviewTopic] = useState<string | null>(null);
  const [pinnedTopic, setPinnedTopic] = useState<string | null>(null);
  const activeTopic = pinnedTopic ?? previewTopic;

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
        <ResponsiveContainer minWidth={0} initialDimension={initialDimension}>
          <BarChart
            data={props.data}
            margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            onMouseMove={(evt) => {
              const nextTopic = getActiveBarTopic(evt);
              if (nextTopic) {
                setPreviewTopic(nextTopic);
              }
            }}
          >
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
            <Bar
              yAxisId="left"
              dataKey="count"
              name="videos"
              fill="var(--rp-price)"
              onClick={(payload) => {
                const topic = getClickedBarTopic(payload);
                if (!topic) {
                  return;
                }
                setPinnedTopic((prev) => (prev === topic ? null : topic));
              }}
            />
            <Bar
              yAxisId="right"
              dataKey="avgHype"
              name="avg hype"
              fill="var(--rp-warn)"
              onClick={(payload) => {
                const topic = getClickedBarTopic(payload);
                if (!topic) {
                  return;
                }
                setPinnedTopic((prev) => (prev === topic ? null : topic));
              }}
            />
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
          <strong>Hover</strong> a topic to preview videos, then <strong>click</strong> to pin.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => {
              setPinnedTopic((prev) => {
                if (prev) {
                  return null;
                }

                return previewTopic;
              });
            }}
            disabled={!previewTopic && !pinnedTopic}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--rp-border)",
              background: "var(--rp-surface-2)",
              color: "var(--rp-text)",
              cursor: !previewTopic && !pinnedTopic ? "not-allowed" : "pointer"
            }}
          >
            {pinnedTopic ? "Unpin topic" : "Pin topic"}
          </button>

          <button
            type="button"
            onClick={() => {
              setPinnedTopic(null);
              setPreviewTopic(null);
            }}
            disabled={!previewTopic && !pinnedTopic}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid var(--rp-border)",
              background: "transparent",
              color: "var(--rp-muted)",
              cursor: !previewTopic && !pinnedTopic ? "not-allowed" : "pointer"
            }}
          >
            Clear
          </button>
        </div>

        {activeDatum ? (
          <p className="report-muted">
            <strong>Videos:</strong> {activeDatum.videos.length} (topic: {activeDatum.topic})
            {pinnedTopic ? " (pinned)" : null}
          </p>
        ) : null}

        {activeDatum ? <CnbcVideoCards videos={activeDatum.videos} /> : <p className="report-muted">No topic selected.</p>}
      </div>
    </div>
  );
}
