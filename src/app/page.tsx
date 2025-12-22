import Link from "next/link";

import { listAnalysisDates, listReportDates } from "../market/storage";

export default async function HomePage() {
  const [reportDates, analysisDates] = await Promise.all([listReportDates(), listAnalysisDates()]);

  return (
    <>
      <h1>Charlie technicals</h1>
      <p>
        Stage 3 reports live in <code>content/reports</code>. Stage 2 analysis pages live in <code>content/analysis</code>.
      </p>

      {reportDates.length === 0 ? (
        <p>
          No reports yet. Run <code>bun run market:run</code> to generate today&apos;s report.
        </p>
      ) : (
        <>
          <h2>Reports</h2>
          <ul>
            {reportDates
              .slice()
              .reverse()
              .map((date) => (
                <li key={date}>
                  <Link href={`/reports/${date}`}>{date}</Link>
                </li>
              ))}
          </ul>
        </>
      )}

      {analysisDates.length === 0 ? null : (
        <>
          <h2>Analysis</h2>
          <ul>
            {analysisDates
              .slice()
              .reverse()
              .map((date) => (
                <li key={date}>
                  <Link href={`/analysis/${date}`}>{date}</Link>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}
