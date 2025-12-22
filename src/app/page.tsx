import Link from "next/link";

import { listReportDates } from "../market/storage";

export default async function HomePage() {
  const dates = await listReportDates();

  return (
    <>
      <h1>Charlie technicals</h1>
      <p>
        Daily market reports live in <code>content/reports</code>.
      </p>

      {dates.length === 0 ? (
        <p>
          No reports yet. Run <code>bun run market:run</code> to generate today&apos;s report.
        </p>
      ) : (
        <>
          <h2>Reports</h2>
          <ul>
            {dates
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
    </>
  );
}
