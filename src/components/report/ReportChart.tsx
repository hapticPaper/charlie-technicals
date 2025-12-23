"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { useEffect, useMemo, useState } from "react";

import type { ReportIntervalSeries, TradePlan } from "../../market/types";

import { getRechartsInitialDimension } from "./rechartsConfig";
type SqueezeShade = {
  x1: number;
  x2: number;
  fill: string;
};

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

function buildSqueezeShades(series: ReportIntervalSeries): SqueezeShade[] {
  const squeezeShades: SqueezeShade[] = [];
  if (!series.ttmSqueeze20?.squeezeState || series.ttmSqueeze20.squeezeState.length !== series.t.length) {
    return squeezeShades;
  }

  let activeState: "on" | "off" | null = null;
  let activeStart: number | null = null;

  for (let i = 0; i < series.t.length; i += 1) {
    const t = series.t[i];
    const stateRaw = series.ttmSqueeze20.squeezeState[i];
    const state = stateRaw === "on" ? "on" : stateRaw === "off" ? "off" : null;

    if (activeState === null) {
      if (state) {
        activeState = state;
        activeStart = t;
      }
      continue;
    }

    if (state !== activeState) {
      const end = series.t[i - 1] ?? t;
      // Single-tick segments are intentionally ignored because `ReferenceArea` doesn't render meaningfully when x1 == x2.
      if (activeStart !== null && end > activeStart) {
        squeezeShades.push({
          x1: activeStart,
          x2: end,
          fill: activeState === "on" ? "var(--rp-squeeze-on)" : "var(--rp-squeeze-off)"
        });
      }

      activeState = state;
      activeStart = state ? t : null;
    }
  }

  if (activeState && activeStart !== null) {
    const end = series.t[series.t.length - 1];
    if (typeof end === "number" && end > activeStart) {
      squeezeShades.push({
        x1: activeStart,
        x2: end,
        fill: activeState === "on" ? "var(--rp-squeeze-on)" : "var(--rp-squeeze-off)"
      });
    }
  }

  return squeezeShades;
}

export function ReportChart(props: {
  title?: string;
  series: ReportIntervalSeries;
  annotations?: ChartAnnotations;
  showSignals?: boolean;
}) {
  const priceChartInitialDimension = useMemo(getRechartsInitialDimension, []);
  const rsiChartInitialDimension = useMemo(getRechartsInitialDimension, []);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { series, annotations } = props;

  const squeezeShades = useMemo(() => buildSqueezeShades(series), [series]);

  const data = series.t.map((t, i) => ({
    t,
    close: series.close[i],
    sma20: series.sma20[i] ?? undefined,
    ema20: series.ema20[i] ?? undefined,
    rsi14: series.rsi14[i] ?? undefined,
    bbUpper: series.bollinger20?.upper[i] ?? undefined,
    bbLower: series.bollinger20?.lower[i] ?? undefined,
    kcUpper: series.keltner20?.upper[i] ?? undefined,
    kcLower: series.keltner20?.lower[i] ?? undefined
  }));

  const active = series.signals.filter((s) => s.active).map((s) => s.label);
  const trade = annotations?.trade;
  const isBuy = trade?.side === "buy";
  const legendItems = ["Price", "SMA 20", "EMA 20"];
  if (series.bollinger20) {
    legendItems.push("Bollinger Bands (20)");
  }
  if (series.keltner20) {
    legendItems.push("Keltner Channels (20)");
  }
  if (squeezeShades.length > 0) {
    legendItems.push("TTM Squeeze shading");
  }

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
        <ResponsiveContainer minWidth={0} initialDimension={priceChartInitialDimension}>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            {squeezeShades.map((s, idx) => (
              <ReferenceArea
                key={`sq-${idx}`}
                x1={s.x1}
                x2={s.x2}
                strokeOpacity={0}
                fill={s.fill}
                ifOverflow="hidden"
              />
            ))}
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

            {series.bollinger20 ? (
              <>
                <Line
                  type="monotone"
                  dataKey="bbUpper"
                  stroke="var(--rp-bollinger)"
                  strokeDasharray="4 2"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="bbLower"
                  stroke="var(--rp-bollinger)"
                  strokeDasharray="4 2"
                  dot={false}
                />
              </>
            ) : null}

            {series.keltner20 ? (
              <>
                <Line
                  type="monotone"
                  dataKey="kcUpper"
                  stroke="var(--rp-keltner)"
                  strokeDasharray="2 2"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="kcLower"
                  stroke="var(--rp-keltner)"
                  strokeDasharray="2 2"
                  dot={false}
                />
              </>
            ) : null}

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

      <p className="report-muted" style={{ margin: "8px 0 0" }}>
        <strong>Legend:</strong> {legendItems.join(" / ")}
      </p>

      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer minWidth={0} initialDimension={rsiChartInitialDimension}>
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
