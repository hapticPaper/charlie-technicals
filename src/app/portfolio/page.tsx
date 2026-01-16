import Link from "next/link";

import { listSetupReviewPerformances } from "../../market/setupReviewStorage";
import type { SetupReviewPerformance } from "../../market/types";
import { formatDateYYYYMMDD } from "../../lib/date";

import styles from "./portfolio.module.css";

// Normalized notional used for aggregating setup performance. This is not the actual traded size.
const ASSUMED_SETUP_NOTIONAL_USD = 1000;

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
  const notional = assumedNotionalUsd(perf);
  if (notional === 0) {
    return null;
  }

  const pct = pnlPctFor(perf);
  if (pct == null || !Number.isFinite(pct)) {
    return null;
  }

  return (pct / 100) * notional;
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

function finalizedAt(perf: SetupReviewPerformance): string | null {
  return perf.tp2At ?? perf.stopAt;
}

function splitPositions(items: SetupReviewPerformance[]): {
  open: SetupReviewPerformance[];
  closed: SetupReviewPerformance[];
  ignored: { pending: number; notOpened: number };
} {
  const open: SetupReviewPerformance[] = [];
  const closed: SetupReviewPerformance[] = [];
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

    if (p.status === "closed") {
      closed.push(p);
    } else {
      open.push(p);
    }
  }

  open.sort((a, b) => b.openedAt!.localeCompare(a.openedAt!) || a.symbol.localeCompare(b.symbol));
  closed.sort((a, b) => {
    const aFinal = finalizedAt(a) ?? "";
    const bFinal = finalizedAt(b) ?? "";
    return bFinal.localeCompare(aFinal) || b.openedAt!.localeCompare(a.openedAt!) || a.symbol.localeCompare(b.symbol);
  });

  return { open, closed, ignored: { pending, notOpened } };
}

function aggregate(items: SetupReviewPerformance[]): {
  investedUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
} {
  let investedUsd = 0;
  let pnlUsd = 0;

  for (const perf of items) {
    const notional = assumedNotionalUsd(perf);
    if (notional === 0) {
      continue;
    }

    const pct = pnlPctFor(perf);
    if (pct == null || !Number.isFinite(pct)) {
      continue;
    }

    investedUsd += notional;
    pnlUsd += (pct / 100) * notional;
  }

  const pnlPct = investedUsd > 0 ? (pnlUsd / investedUsd) * 100 : null;
  return { investedUsd, pnlUsd, pnlPct };
}

function renderOpenTable(rows: SetupReviewPerformance[]) {
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

function renderClosedTable(rows: SetupReviewPerformance[]) {
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

  const openAggPctLabel = openAgg.pnlPct == null ? "--" : formatSignedPct(openAgg.pnlPct);
  const openAggUsdLabel = openAgg.investedUsd === 0 ? "--" : formatSignedUsd(openAgg.pnlUsd);
  const closedAggPctLabel = closedAgg.pnlPct == null ? "--" : formatSignedPct(closedAgg.pnlPct);
  const closedAggUsdLabel = closedAgg.investedUsd === 0 ? "--" : formatSignedUsd(closedAgg.pnlUsd);
  const totalAggPctLabel = totalAgg.pnlPct == null ? "--" : formatSignedPct(totalAgg.pnlPct);
  const totalAggUsdLabel = totalAgg.investedUsd === 0 ? "--" : formatSignedUsd(totalAgg.pnlUsd);

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
          <div className="report-muted">
            {openAggPctLabel} ({openAggUsdLabel}) on ${openAgg.investedUsd.toFixed(0)}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Closed</div>
          <div className={styles.summaryValue}>{closed.length}</div>
          <div className="report-muted">
            {closedAggPctLabel} ({closedAggUsdLabel}) on ${closedAgg.investedUsd.toFixed(0)}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Total</div>
          <div className={styles.summaryValue}>{open.length + closed.length}</div>
          <div className="report-muted">
            {totalAggPctLabel} ({totalAggUsdLabel}) on ${totalAgg.investedUsd.toFixed(0)}
          </div>
        </div>
      </div>

      {ignored.pending > 0 || ignored.notOpened > 0 ? (
        <p className="report-muted">
          Ignoring {ignored.pending} pending setup{ignored.pending === 1 ? "" : "s"} and {ignored.notOpened} not-opened setup
          {ignored.notOpened === 1 ? "" : "s"}.
        </p>
      ) : null}

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
