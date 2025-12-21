"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { MarketInterval } from "../../market/types";
import { useReport } from "./ReportProvider";

export function ReportCharts(props: { symbol: string; interval: MarketInterval }) {
  const report = useReport();
  const series = report.series[props.symbol]?.[props.interval];
  if (!series) {
    const isMissingSymbol = report.missingSymbols.includes(props.symbol);
    return <p>{isMissingSymbol ? "No data from provider for this symbol." : "Missing series."}</p>;
  }

  const data = series.t.map((t, i) => ({
    t,
    close: series.close[i],
    sma20: series.sma20[i] ?? undefined,
    ema20: series.ema20[i] ?? undefined,
    rsi14: series.rsi14[i] ?? undefined
  }));
  const active = series.signals.filter((s) => s.active).map((s) => s.label);

  if (process.env.NODE_ENV !== "production") {
    for (let i = 1; i < data.length; i += 1) {
      if (data[i].t < data[i - 1].t) {
        console.warn(`[ReportCharts] points out of order for ${props.symbol} ${props.interval}`);
        break;
      }
    }
  }

  return (
    <section>
      {active.length > 0 ? (
        <p>
          <strong>Active signals:</strong> {active.join("; ")}
        </p>
      ) : (
        <p>
          <strong>Active signals:</strong> none
        </p>
      )}

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis hide dataKey="t" />
            <YAxis domain={["auto", "auto"]} />
            <Tooltip />
            <Line type="monotone" dataKey="close" stroke="#111" dot={false} />
            <Line type="monotone" dataKey="sma20" stroke="#2563eb" dot={false} />
            <Line type="monotone" dataKey="ema20" stroke="#dc2626" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis hide dataKey="t" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Line type="monotone" dataKey="rsi14" stroke="#16a34a" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
