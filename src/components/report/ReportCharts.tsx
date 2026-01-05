import type { MarketInterval, MarketReport } from "../../market/types";
import { ReportChart } from "./ReportChart";

export function ReportCharts(props: { report: MarketReport; symbol: string; interval: MarketInterval }) {
  const { report, symbol, interval } = props;
  if (!report) {
    throw new Error("ReportCharts must be rendered with a `report` prop.");
  }

  const series = report.series[symbol]?.[interval];
  if (!series) {
    const isMissingSymbol = report.missingSymbols.includes(symbol);
    return <p>{isMissingSymbol ? "No data from provider for this symbol." : "Missing series."}</p>;
  }

  const pick = report.picks.find((p) => p.symbol === symbol);
  return (
    <ReportChart
      title={`${symbol} ${interval}`}
      series={series}
      annotations={pick ? { trade: pick.trade } : undefined}
      showSignals
    />
  );
}
