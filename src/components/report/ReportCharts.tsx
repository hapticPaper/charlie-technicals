import type { MarketInterval, ReportIntervalSeries, TradePlan } from "../../market/types";
import { ReportChart } from "./ReportChart";

export function ReportCharts(props: {
  symbol: string;
  interval: MarketInterval;
  series?: ReportIntervalSeries;
  trade?: TradePlan;
  isMissingSymbol?: boolean;
}) {
  const { symbol, interval, series, trade, isMissingSymbol } = props;
  if (typeof isMissingSymbol !== "boolean") {
    console.error("[reports] ReportCharts missing injected props", { symbol, interval });
    return <p>Unable to render chart (missing report data).</p>;
  }

  if (!series) {
    return <p>{isMissingSymbol ? "No data from provider for this symbol." : "Missing series."}</p>;
  }

  return (
    <ReportChart
      title={`${symbol} ${interval}`}
      series={series}
      annotations={trade ? { trade } : undefined}
      showSignals
    />
  );
}
