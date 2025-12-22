"use client";

import { useReport } from "./ReportProvider";

export function ReportSummary() {
  const report = useReport();

  return (
    <section>
      <h2>Highlights</h2>

      {report.picks.length > 0 ? (
        <>
          <p className="report-muted">
            <strong>Top setups:</strong>
          </p>
          <ul>
            {report.picks.map((p) => (
              <li key={p.symbol}>
                <strong>{p.symbol}</strong>: {p.trade.side.toUpperCase()} entry {p.trade.entry.toFixed(2)}, stop{" "}
                {p.trade.stop.toFixed(2)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p>
        <strong>Main idea:</strong> {report.summaries.mainIdea}
      </p>
      <p className="report-muted">{report.summaries.veryShort}</p>

      <details className="report-muted">
        <summary>Full context</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{report.summaries.summary}</pre>
      </details>
    </section>
  );
}
