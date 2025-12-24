import Link from "next/link";
import { rm } from "node:fs/promises";

import styles from "./home.module.css";
import { CnbcTopicTrendWidget } from "../components/cnbc/CnbcTopicTrendWidget";
import {
  getReportHighlightsJsonPath,
  getReportJsonPath,
  listReportDates,
  readJson,
  toReportHighlights
} from "../market/reportStorage";
import type { MarketReport, MarketReportHighlights, TradeSide } from "../market/types";

async function readReportHighlights(date: string): Promise<MarketReportHighlights> {
  const highlightsPath = getReportHighlightsJsonPath(date);
  const reportPath = getReportJsonPath(date);

  try {
    const highlights = await readJson<MarketReportHighlights>(highlightsPath);
    if (highlights.version === "v2-highlights" && highlights.date === date) {
      return highlights;
    }

    console.warn(
      `[home] Invalid highlights cache for ${date}: expected version v2-highlights and date ${date}; found version ${highlights.version} and date ${highlights.date}. Deleting cache.`
    );

    try {
      await rm(highlightsPath, { force: true });
    } catch {
      // Best-effort cleanup.
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code !== "ENOENT") {
      try {
        await rm(highlightsPath, { force: true });
      } catch {
        // Best-effort cleanup.
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[home] Bad highlights cache for ${date}: ${message}`);
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
    default: {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[home] Unexpected trade side: ${String(side)}`);
      }
      return styles.badgeNeutral;
    }
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

function toTimestamp(date: string): number | null {
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    const ts = Date.UTC(Number(year), Number(month) - 1, Number(day));
    return Number.isFinite(ts) ? ts : null;
  }

  const isoWithTzMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      date,
    );
  if (!isoWithTzMatch) {
    return null;
  }

  const ts = Date.parse(date);
  return Number.isFinite(ts) ? ts : null;
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

  // Prefer chronological sort when possible; push unrecognized formats to the end.
  const sortKey = (date: string): { valid: boolean; ts: number; raw: string } => {
    const ts = toTimestamp(date);
    return { valid: ts !== null, ts: ts ?? 0, raw: date };
  };

  const sortedCards = cards.slice().sort((a, b) => {
    const aKey = sortKey(a.date);
    const bKey = sortKey(b.date);

    if (aKey.valid !== bKey.valid) {
      return aKey.valid ? -1 : 1;
    }

    if (aKey.ts !== bKey.ts) {
      return bKey.ts - aKey.ts;
    }

    return bKey.raw.localeCompare(aKey.raw);
  });
  const latestCard = sortedCards[0] ?? null;
  const historyCards = sortedCards.slice(1);

  return (
    <>
      <h1>Charlie technicals</h1>
      <p className="report-muted">Daily highlights. Click a day for the full rundown.</p>

      {latestCard ? (
        <>
          <h2>Today ({latestCard.date})</h2>
          <p className="report-muted">Market summary from the latest generated report.</p>

          <Link className={`${styles.card} ${styles.latestCard}`} href={`/reports/${latestCard.date}`}>
            <div className={styles.cardHeader}>
              <div className={styles.date}>{latestCard.date}</div>
              <div className={styles.meta}>
                {latestCard.status === "ok" ? `${latestCard.highlights.picks.length} picks` : "Highlights unavailable"}
              </div>
            </div>

            <p className={styles.mainIdea}>
              {latestCard.status === "ok" ? latestCard.highlights.summaries.mainIdea : "Click through for the full report."}
            </p>
            {latestCard.status === "ok" ? (
              <p className={styles.veryShort}>{latestCard.highlights.summaries.veryShort}</p>
            ) : null}

            {latestCard.status === "ok" && latestCard.highlights.picks.length > 0 ? (
              <ul className={styles.picks}>
                {latestCard.highlights.picks.map((p) => (
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
        </>
      ) : null}

      <CnbcTopicTrendWidget />

      {historyCards.length > 0 ? <h2>History</h2> : null}
      {failedCards > 0 ? <p className="report-muted">{failedCards} report card(s) failed to load.</p> : null}

      <div className={styles.grid}>
        {historyCards.map((card) => {
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
