import Link from "next/link";

import { listSetupReviewPerformances } from "../../market/setupReviewStorage";
import type { SetupReviewPerformance } from "../../market/types";

import styles from "./portfolio.module.css";

function formatSignedPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function pnlPctFor(perf: SetupReviewPerformance): number | null {
  if (perf.status === "closed") {
    return perf.realizedPct;
  }

  return perf.totalPct;
}

function assumedNotionalUsd(perf: SetupReviewPerformance): number {
  if (!perf.openedAt) {
    return 0;
  }

  const entry = perf.trade.entry;
  if (!Number.isFinite(entry) || entry <= 0) {
    return 0;
  }

  return Math.max(1000, entry);
}

function hitLabel(hit: boolean): string {
  return hit ? "Yes" : "No";
}

function splitPerformances(items: SetupReviewPerformance[]): {
  open: SetupReviewPerformance[];
  closed: SetupReviewPerformance[];
} {
  const open: SetupReviewPerformance[] = [];
  const closed: SetupReviewPerformance[] = [];

  for (const p of items) {
    if (p.status === "closed") {
      closed.push(p);
    } else {
      open.push(p);
    }
  }

  open.sort((a, b) => b.setupDate.localeCompare(a.setupDate) || a.symbol.localeCompare(b.symbol));
  closed.sort((a, b) => b.setupDate.localeCompare(a.setupDate) || a.symbol.localeCompare(b.symbol));

  return { open, closed };
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

function renderTable(rows: SetupReviewPerformance[]) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Opened</th>
            <th>Hit SL</th>
            <th>Hit TP1</th>
            <th>Hit both TP</th>
            <th>Performance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const opened = Boolean(p.openedAt);
            const hitSl = Boolean(p.stopAt);
            const hitTp1 = Boolean(p.tp1At);
            const hitTp2 = Boolean(p.tp2At);
            const pnlPct = pnlPctFor(p);

            const pnlClass =
              pnlPct == null
                ? styles.pnlNeutral
                : pnlPct > 0
                  ? styles.pnlPositive
                  : pnlPct < 0
                    ? styles.pnlNegative
                    : styles.pnlNeutral;
            const pnlLabel = pnlPct == null ? "--" : formatSignedPct(pnlPct);

            return (
              <tr key={`${p.setupDate}-${p.symbol}`}>
                <td>
                  <Link href={`/reports/${p.setupDate}`}>{p.setupDate}</Link>
                </td>
                <td>
                  <strong>{p.symbol}</strong>
                </td>
                <td>{p.trade.side.toUpperCase()}</td>
                <td>{hitLabel(opened)}</td>
                <td>{hitLabel(hitSl)}</td>
                <td>{hitLabel(hitTp1)}</td>
                <td>{hitLabel(hitTp1 && hitTp2)}</td>
                <td className={pnlClass}>{pnlLabel}</td>
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

  const { open, closed } = splitPerformances(all);
  const openAgg = aggregate(open);
  const closedAgg = aggregate(closed);
  const totalAgg = aggregate([...open, ...closed]);

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1>Portfolio</h1>
          <p className="report-muted">Running + final performance for tracked setups.</p>
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
            {openAgg.pnlPct == null ? "--" : formatSignedPct(openAgg.pnlPct)} on ${openAgg.investedUsd.toFixed(0)}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Closed</div>
          <div className={styles.summaryValue}>{closed.length}</div>
          <div className="report-muted">
            {closedAgg.pnlPct == null ? "--" : formatSignedPct(closedAgg.pnlPct)} on ${closedAgg.investedUsd.toFixed(0)}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Total</div>
          <div className={styles.summaryValue}>{open.length + closed.length}</div>
          <div className="report-muted">
            {totalAgg.pnlPct == null ? "--" : formatSignedPct(totalAgg.pnlPct)} on ${totalAgg.investedUsd.toFixed(0)}
          </div>
        </div>
      </div>

      {open.length > 0 ? (
        <>
          <h2>Open</h2>
          {renderTable(open)}
        </>
      ) : (
        <p className="report-muted">No open positions.</p>
      )}

      {closed.length > 0 ? (
        <>
          <h2>Closed</h2>
          {renderTable(closed)}
        </>
      ) : null}
    </>
  );
}
