import type { MarketInterval, ReportIntervalSeries, TradePlan } from "../../market/types";
import { ReportChart } from "./ReportChart";

export function ReportCharts(props: {
  symbol: string;
  interval: MarketInterval;
  series?: ReportIntervalSeries;
  trade?: TradePlan;
  isMissingSymbol?: boolean;
}) {
  const { symbol, interval, series, trade, isMissingSymbol = false } = props;
  if (props.isMissingSymbol === undefined) {
    console.error("[reports] ReportCharts missing `isMissingSymbol` prop", { symbol, interval });
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
