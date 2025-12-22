"use client";

import type { MarketInterval } from "../../market/types";
import { useAnalysis } from "./AnalysisProvider";

export function AnalysisSeries(props: { symbol: string; interval: MarketInterval }) {
  const analysis = useAnalysis();
  const series = analysis.series[props.symbol]?.[props.interval];
  if (!series) {
    const isMissingSymbol = analysis.missingSymbols.includes(props.symbol);
    return <p>{isMissingSymbol ? "No data from provider for this symbol." : "Missing series."}</p>;
  }

  return (
    <section>
      <p>
        <strong>Bars:</strong> {series.barCount}
      </p>
      <p>
        <strong>Latest bar:</strong>{" "}
        {series.lastBarTime ?? "unknown"} ({series.lastClose ?? "unknown"})
      </p>
      {series.activeSignals.length > 0 ? (
        <p>
          <strong>Active signals:</strong> {series.activeSignals.join("; ")}
        </p>
      ) : (
        <p>
          <strong>Active signals:</strong> none
        </p>
      )}
    </section>
  );
}
