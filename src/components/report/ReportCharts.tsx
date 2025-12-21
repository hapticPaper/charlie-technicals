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
    return <p>Missing series.</p>;
  }

  const data = series.points;
  const active = series.signals.filter((s) => s.active).map((s) => s.label);

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
