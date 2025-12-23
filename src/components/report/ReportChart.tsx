"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { useEffect, useState } from "react";

import type { ReportIntervalSeries, TradePlan } from "../../market/types";

type ChartAnnotations = {
  trade?: TradePlan;
};

function formatEpochSeconds(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  const dt = new Date(value * 1000);
  return dt.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ReportChart(props: {
  title?: string;
  series: ReportIntervalSeries;
  annotations?: ChartAnnotations;
  showSignals?: boolean;
}) {
  const initialDimension = { width: 1, height: 1 };

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { series, annotations } = props;

  const data = series.t.map((t, i) => ({
    t,
    close: series.close[i],
    sma20: series.sma20[i] ?? undefined,
    ema20: series.ema20[i] ?? undefined,
    rsi14: series.rsi14[i] ?? undefined
  }));

  const active = series.signals.filter((s) => s.active).map((s) => s.label);
  const trade = annotations?.trade;
  const isBuy = trade?.side === "buy";

  if (!mounted) {
    return (
      <section>
        {props.title ? <h4 className="report-h4">{props.title}</h4> : null}
        {props.showSignals ? (
          <p className="report-muted">
            <strong>Signals:</strong> {active.length > 0 ? active.join("; ") : "none"}
          </p>
        ) : null}

        <div
          style={{
            width: "100%",
            height: 260,
            borderRadius: 12,
            border: "1px solid var(--rp-border)",
            background: "var(--rp-surface)"
          }}
        />
        <div
          style={{
            width: "100%",
            height: 200,
            marginTop: 12,
            borderRadius: 12,
            border: "1px solid var(--rp-border)",
            background: "var(--rp-surface)"
          }}
        />
      </section>
    );
  }

  return (
    <section>
      {props.title ? <h4 className="report-h4">{props.title}</h4> : null}

      {props.showSignals ? (
        <p className="report-muted">
          <strong>Signals:</strong> {active.length > 0 ? active.join("; ") : "none"}
        </p>
      ) : null}

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer minWidth={0} initialDimension={initialDimension}>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke="var(--rp-grid)" strokeDasharray="3 3" />
            <XAxis
              hide
              dataKey="t"
              tickFormatter={formatEpochSeconds}
              tick={{ fill: "var(--rp-muted)" }}
            />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--rp-muted)" }} />
            <Tooltip
              labelFormatter={formatEpochSeconds}
              contentStyle={{
                background: "var(--rp-surface)",
                border: "1px solid var(--rp-border)",
                color: "var(--rp-text)"
              }}
            />

            <Line type="monotone" dataKey="close" stroke="var(--rp-price)" dot={false} />
            <Line type="monotone" dataKey="sma20" stroke="var(--rp-sma)" dot={false} />
            <Line type="monotone" dataKey="ema20" stroke="var(--rp-ema)" dot={false} />

            {trade ? (
              <ReferenceLine
                y={trade.entry}
                stroke={isBuy ? "var(--rp-bull)" : "var(--rp-bear)"}
                strokeDasharray="4 2"
                label={{ value: `Entry ${trade.entry.toFixed(2)}`, fill: "var(--rp-text)" }}
              />
            ) : null}
            {trade ? (
              <ReferenceLine
                y={trade.stop}
                stroke={"var(--rp-warn)"}
                strokeDasharray="4 2"
                label={{ value: `Stop ${trade.stop.toFixed(2)}`, fill: "var(--rp-text)" }}
              />
            ) : null}
            {trade?.targets?.map((t, idx) => (
              <ReferenceLine
                key={`t-${idx}`}
                y={t}
                stroke={"var(--rp-target)"}
                strokeDasharray="2 2"
                label={{ value: `T${idx + 1} ${t.toFixed(2)}`, fill: "var(--rp-text)" }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer minWidth={0} initialDimension={initialDimension}>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke="var(--rp-grid)" strokeDasharray="3 3" />
            <XAxis hide dataKey="t" tickFormatter={formatEpochSeconds} tick={{ fill: "var(--rp-muted)" }} />
            <YAxis domain={[0, 100]} tick={{ fill: "var(--rp-muted)" }} />
            <Tooltip
              labelFormatter={formatEpochSeconds}
              contentStyle={{
                background: "var(--rp-surface)",
                border: "1px solid var(--rp-border)",
                color: "var(--rp-text)"
              }}
            />
            <Line type="monotone" dataKey="rsi14" stroke="var(--rp-rsi)" dot={false} />
            <ReferenceLine y={70} stroke="var(--rp-border)" strokeDasharray="2 4" />
            <ReferenceLine y={30} stroke="var(--rp-border)" strokeDasharray="2 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
