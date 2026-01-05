import type { MarketInterval, MarketReport } from "../../market/types";
import { ReportChart } from "./ReportChart";

export function ReportCharts(props: { report: MarketReport; symbol: string; interval: MarketInterval }) {
  const report = props.report;
  const series = report.series[props.symbol]?.[props.interval];
  if (!series) {
    const isMissingSymbol = report.missingSymbols.includes(props.symbol);
    return <p>{isMissingSymbol ? "No data from provider for this symbol." : "Missing series."}</p>;
  }

  const pick = report.picks.find((p) => p.symbol === props.symbol);
  return (
    <ReportChart
      title={`${props.symbol} ${props.interval}`}
      series={series}
      annotations={pick ? { trade: pick.trade } : undefined}
      showSignals
    />
  );
}
