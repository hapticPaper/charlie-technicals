import Link from "next/link";

import { listSetupReviewPerformances } from "../../market/setupReviewStorage";
import type { SetupReviewPerformance } from "../../market/types";
import { formatDateYYYYMMDD } from "../../lib/date";

import styles from "./portfolio.module.css";

// Normalized notional used for aggregating setup performance. This is not the actual traded size.
const ASSUMED_SETUP_NOTIONAL_USD = 1000;

type OpenedSetupReviewPerformance = SetupReviewPerformance & { openedAt: string };

function formatSignedPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatSignedUsd(value: number): string {
  if (value < 0) {
    return `-$${Math.abs(value).toFixed(2)}`;
  }

  return `+$${value.toFixed(2)}`;
}

function formatIsoDate(date: string | null): string {
  if (!date) {
    return "--";
  }

  return formatDateYYYYMMDD(new Date(date));
}

function pnlPctFor(perf: SetupReviewPerformance): number | null {
  if (perf.status === "closed") {
    return perf.realizedPct;
  }

  return perf.totalPct;
}

function pnlUsdFor(perf: SetupReviewPerformance): number | null {
  return pnlUsdComponents(perf).pnlUsd;
}

function assumedNotionalUsd(perf: SetupReviewPerformance): number {
  if (!perf.openedAt) {
    return 0;
  }

  if (!Number.isFinite(perf.trade.entry) || perf.trade.entry <= 0) {
    return 0;
  }

  return ASSUMED_SETUP_NOTIONAL_USD;
}

function pnlUsdComponents(perf: SetupReviewPerformance): { notional: number; pnlUsd: number | null } {
  const notional = assumedNotionalUsd(perf);
  if (notional === 0) {
    return { notional, pnlUsd: null };
  }

  const pct = pnlPctFor(perf);
  if (pct == null || !Number.isFinite(pct)) {
    return { notional, pnlUsd: null };
  }

  return { notional, pnlUsd: (pct / 100) * notional };
}

function finalizedAt(perf: SetupReviewPerformance): string | null {
  if (!perf.tp2At) {
    return perf.stopAt;
  }

  if (!perf.stopAt) {
    return perf.tp2At;
  }

  return perf.tp2At > perf.stopAt ? perf.tp2At : perf.stopAt;
}

function splitPositions(items: SetupReviewPerformance[]): {
  open: OpenedSetupReviewPerformance[];
  closed: OpenedSetupReviewPerformance[];
  ignored: { pending: number; notOpened: number };
} {
  const open: OpenedSetupReviewPerformance[] = [];
  const closed: OpenedSetupReviewPerformance[] = [];
  let pending = 0;
  let notOpened = 0;

  for (const p of items) {
    if (!p.openedAt) {
      if (p.status === "open") {
        pending += 1;
      } else {
        notOpened += 1;
      }
      continue;
    }

    const openedPerf = p as OpenedSetupReviewPerformance;
    if (openedPerf.status === "closed") {
      closed.push(openedPerf);
    } else {
      open.push(openedPerf);
    }
  }

  open.sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.symbol.localeCompare(b.symbol));
  closed.sort(compareClosedPositions);

  return { open, closed, ignored: { pending, notOpened } };
}

function compareClosedPositions(a: OpenedSetupReviewPerformance, b: OpenedSetupReviewPerformance): number {
  const aFinal = finalizedAt(a);
  const bFinal = finalizedAt(b);

  if (!aFinal && !bFinal) {
    return b.openedAt.localeCompare(a.openedAt) || a.symbol.localeCompare(b.symbol);
  }

  if (!aFinal) {
    return 1;
  }

  if (!bFinal) {
    return -1;
  }

  return bFinal.localeCompare(aFinal) || b.openedAt.localeCompare(a.openedAt) || a.symbol.localeCompare(b.symbol);
}

function aggregate(items: SetupReviewPerformance[]): {
  investedUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
} {
  let investedUsd = 0;
  let pnlUsd = 0;

  for (const perf of items) {
    const { notional, pnlUsd: rowPnlUsd } = pnlUsdComponents(perf);
    if (notional === 0 || rowPnlUsd == null) {
      continue;
    }

    investedUsd += notional;
    pnlUsd += rowPnlUsd;
  }

  const pnlPct = investedUsd > 0 ? (pnlUsd / investedUsd) * 100 : null;
  return { investedUsd, pnlUsd, pnlPct };
}

function formatSummaryPnl(agg: { investedUsd: number; pnlUsd: number; pnlPct: number | null }): string {
  if (agg.investedUsd === 0 || agg.pnlPct == null) {
    return `-- (--) on $${agg.investedUsd.toFixed(0)}`;
  }

  const pctLabel = formatSignedPct(agg.pnlPct);
  const usdLabel = formatSignedUsd(agg.pnlUsd);
  return `${pctLabel} (${usdLabel}) on $${agg.investedUsd.toFixed(0)}`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }

  if (parts.length === 2) {
    return parts.join(" and ");
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function renderOpenTable(rows: OpenedSetupReviewPerformance[]) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Opened on</th>
            <th>P&amp;L %</th>
            <th>P&amp;L $</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const pnlPct = pnlPctFor(p);
            const pnlUsd = pnlUsdFor(p);

            const pnlClass =
              pnlPct == null
                ? styles.pnlNeutral
                : pnlPct > 0
                  ? styles.pnlPositive
                  : pnlPct < 0
                    ? styles.pnlNegative
                    : styles.pnlNeutral;
            const pnlLabel = pnlPct == null ? "--" : formatSignedPct(pnlPct);
            const pnlUsdLabel = pnlUsd == null ? "--" : formatSignedUsd(pnlUsd);

            return (
              <tr key={`${p.setupDate}-${p.symbol}`}>
                <td>
                  <Link href={`/reports/${p.setupDate}`}>
                    <strong>{p.symbol}</strong>
                  </Link>
                </td>
                <td>{p.trade.side.toUpperCase()}</td>
                <td>{formatIsoDate(p.openedAt)}</td>
                <td className={pnlClass}>{pnlLabel}</td>
                <td className={pnlClass}>{pnlUsdLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderClosedTable(rows: OpenedSetupReviewPerformance[]) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Opened on</th>
            <th>Closed on</th>
            <th>P&amp;L %</th>
            <th>P&amp;L $</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const pnlPct = pnlPctFor(p);
            const pnlUsd = pnlUsdFor(p);

            const pnlClass =
              pnlPct == null
                ? styles.pnlNeutral
                : pnlPct > 0
                  ? styles.pnlPositive
                  : pnlPct < 0
                    ? styles.pnlNegative
                    : styles.pnlNeutral;
            const pnlLabel = pnlPct == null ? "--" : formatSignedPct(pnlPct);
            const pnlUsdLabel = pnlUsd == null ? "--" : formatSignedUsd(pnlUsd);

            return (
              <tr key={`${p.setupDate}-${p.symbol}`}>
                <td>
                  <Link href={`/reports/${p.setupDate}`}>
                    <strong>{p.symbol}</strong>
                  </Link>
                </td>
                <td>{p.trade.side.toUpperCase()}</td>
                <td>{formatIsoDate(p.openedAt)}</td>
                <td>{formatIsoDate(finalizedAt(p))}</td>
                <td className={pnlClass}>{pnlLabel}</td>
                <td className={pnlClass}>{pnlUsdLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function PortfolioPage() {
  const listed = await listSetupReviewPerformances();
  const all = listed.map((l) => l.performance);

  const { open, closed, ignored } = splitPositions(all);
  const openAgg = aggregate(open);
  const closedAgg = aggregate(closed);
  const totalAgg = aggregate([...open, ...closed]);

  const ignoredParts: string[] = [];
  if (ignored.pending > 0) {
    ignoredParts.push(`${ignored.pending} pending setup${ignored.pending === 1 ? "" : "s"}`);
  }
  if (ignored.notOpened > 0) {
    ignoredParts.push(`${ignored.notOpened} not-opened setup${ignored.notOpened === 1 ? "" : "s"}`);
  }

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1>Portfolio</h1>
          <p className="report-muted">
            Running + final performance for tracked setups (assumes a normalized ${"$" + ASSUMED_SETUP_NOTIONAL_USD.toFixed(0)} notional per
            opened setup).
          </p>
        </div>
        <Link className={styles.homeLink} href="/">
          Home
        </Link>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Open</div>
          <div className={styles.summaryValue}>{open.length}</div>
          <div className="report-muted">{formatSummaryPnl(openAgg)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Closed</div>
          <div className={styles.summaryValue}>{closed.length}</div>
          <div className="report-muted">{formatSummaryPnl(closedAgg)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Total</div>
          <div className={styles.summaryValue}>{open.length + closed.length}</div>
          <div className="report-muted">{formatSummaryPnl(totalAgg)}</div>
        </div>
      </div>

      {ignoredParts.length > 0 ? <p className="report-muted">Ignoring {joinWithAnd(ignoredParts)}.</p> : null}

      {open.length > 0 ? (
        <>
          <h2>Open</h2>
          {renderOpenTable(open)}
        </>
      ) : (
        <p className="report-muted">No open positions.</p>
      )}

      {closed.length > 0 ? (
        <>
          <h2>Closed</h2>
          {renderClosedTable(closed)}
        </>
      ) : null}
    </>
  );
}
