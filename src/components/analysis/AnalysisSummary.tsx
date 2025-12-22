"use client";

import { useAnalysis } from "./AnalysisProvider";

function countSeries(analysis: ReturnType<typeof useAnalysis>): number {
  let count = 0;
  for (const byInterval of Object.values(analysis.series)) {
    for (const value of Object.values(byInterval)) {
      if (value) {
        count += 1;
      }
    }
  }
  return count;
}

export function AnalysisSummary() {
  const analysis = useAnalysis();
  const totalSeries = countSeries(analysis);

  return (
    <section>
      <h2>Summary</h2>
      <p>
        <strong>Series analyzed:</strong> {totalSeries}
      </p>
      <p>
        <strong>Missing symbols:</strong>{" "}
        {analysis.missingSymbols.length > 0 ? analysis.missingSymbols.join(", ") : "none"}
      </p>
    </section>
  );
}
