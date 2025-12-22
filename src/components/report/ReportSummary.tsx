"use client";

import { useReport } from "./ReportProvider";

export function ReportSummary() {
  const report = useReport();

  return (
    <section>
      <h2>Summary</h2>
      <p>
        <strong>Very short:</strong> {report.summaries.veryShort}
      </p>
      <p>
        <strong>Main idea:</strong> {report.summaries.mainIdea}
      </p>
      <div>
        <strong>Summary:</strong>
        <pre style={{ whiteSpace: "pre-wrap" }}>{report.summaries.summary}</pre>
      </div>
    </section>
  );
}
