import Link from "next/link";

import styles from "./home.module.css";
import {
  getReportHighlightsJsonPath,
  getReportJsonPath,
  listReportDates,
  readJson,
  toReportHighlights
} from "../market/storage";
import type { MarketReport, MarketReportHighlights, TradeSide } from "../market/types";

async function readReportHighlights(date: string): Promise<MarketReportHighlights> {
  const highlightsPath = getReportHighlightsJsonPath(date);
  const reportPath = getReportJsonPath(date);

  try {
    const highlights = await readJson<MarketReportHighlights>(highlightsPath);
    if (highlights.version === "v2-highlights") {
      return highlights;
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[home] Failed reading highlights for ${date}: ${message}`);
    }
  }

  try {
    const report = await readJson<MarketReport>(reportPath);
    return toReportHighlights(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[home] Failed reading full report for ${date}: ${message}`);
    throw error;
  }
}

function badgeClassForSide(side: TradeSide): string {
  switch (side) {
    case "buy":
      return styles.badgeBuy;
    case "sell":
      return styles.badgeSell;
    default:
      console.error(`[home] Unexpected trade side: ${String(side)}`);
      return styles.badgeNeutral;
  }
}

function labelForSide(side: TradeSide): string {
  switch (side) {
    case "buy":
      return "BUY";
    case "sell":
      return "SELL";
    default:
      return "UNKNOWN";
  }
}

export default async function HomePage() {
  const dates = (await listReportDates()).slice().sort((a, b) => b.localeCompare(a));
  const results = await Promise.allSettled(dates.map((date) => readReportHighlights(date)));

  const cards: Array<
    | { status: "ok"; date: string; highlights: MarketReportHighlights }
    | { status: "error"; date: string }
  > = [];
  let failedCards = 0;

  for (const [idx, r] of results.entries()) {
    if (r.status === "fulfilled") {
      cards.push({ status: "ok", date: r.value.date, highlights: r.value });
      continue;
    }

    failedCards += 1;
    cards.push({ status: "error", date: dates[idx] });
    const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
    console.error(`[home] Failed building card for ${dates[idx]}: ${message}`);
  }

  if (dates.length === 0) {
    return (
      <>
        <h1>Charlie technicals</h1>
        <p>
          No reports yet. Run <code>bun run market:run</code> to generate today&apos;s report.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Charlie technicals</h1>
      <p className="report-muted">Daily highlights. Click a day for the full rundown.</p>

      {failedCards > 0 ? (
        <p className="report-muted">{failedCards} report cards failed to load.</p>
      ) : null}

      <div className={styles.grid}>
        {cards.map((card) => {
          const highlights = card.status === "ok" ? card.highlights : undefined;

          return (
            <Link key={card.date} className={styles.card} href={`/reports/${card.date}`}>
              <div className={styles.cardHeader}>
                <div className={styles.date}>{card.date}</div>
                <div className={styles.meta}>
                  {highlights ? `${highlights.picks.length} picks` : "Highlights unavailable"}
                </div>
              </div>

              <p className={styles.mainIdea}>
                {highlights ? highlights.summaries.mainIdea : "Click through for the full report."}
              </p>

              {highlights && highlights.picks.length > 0 ? (
                <ul className={styles.picks}>
                  {highlights.picks.map((p) => (
                    <li key={p.symbol} className={styles.pickRow}>
                      <span className={badgeClassForSide(p.trade.side)}>{labelForSide(p.trade.side)}</span>
                      <span className={styles.pickText}>
                        <strong>{p.symbol}</strong>{" "}
                        <span className={styles.pickEntry}>Entry {p.trade.entry.toFixed(2)}</span>
                      </span>
                      <span className={styles.pickStop}>Stop {p.trade.stop.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Link>
          );
        })}
      </div>
    </>
  );
}
