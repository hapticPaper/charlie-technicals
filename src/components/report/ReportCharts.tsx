import type { MarketInterval, ReportIntervalSeries, TradePlan } from "../../market/types";
import { ReportChart } from "./ReportChart";

/**
* Renders a report chart for a single symbol + interval.
*
* `isMissingSymbol` should reflect whether the upstream provider was missing this symbol for the report date
* (derived from `MarketReport.missingSymbols`).
*/
export function ReportCharts(props: {
  symbol: string;
  interval: MarketInterval;
  series?: ReportIntervalSeries;
  trade?: TradePlan;
  isMissingSymbol: boolean;
}) {
  const { symbol, interval, series, trade, isMissingSymbol } = props;

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
