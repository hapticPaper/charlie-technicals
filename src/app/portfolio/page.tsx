import Link from "next/link";

import { listSetupReviewPerformances } from "../../market/setupReviewStorage";
import type { SetupReviewPerformance } from "../../market/types";
import { formatDateYYYYMMDD } from "../../lib/date";

import styles from "./portfolio.module.css";

// Normalized notional used for aggregating setup performance. This is not the actual traded size.
const ASSUMED_SETUP_NOTIONAL_USD = 1000;

type OpenedSetupReviewPerformance = SetupReviewPerformance & { openedAt: string };

function hasOpenedAt(perf: SetupReviewPerformance): perf is OpenedSetupReviewPerformance {
  if (typeof perf.openedAt !== "string") {
    return false;
  }

  const openedAt = perf.openedAt.trim();
  if (openedAt.length === 0) {
    return false;
  }

  return true;
}

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

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  return formatDateYYYYMMDD(parsed);
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

  if (!Number.isFinite(perf.trade.entry) || perf.trade.entry <= 0) {
    return 0;
  }

  return ASSUMED_SETUP_NOTIONAL_USD;
}

function assumedQuantity(perf: SetupReviewPerformance): number {
  const notionalUsd = assumedNotionalUsd(perf);
  if (notionalUsd === 0) {
    return 0;
  }

  const entry = perf.trade.entry;
  if (!Number.isFinite(entry) || entry <= 0) {
    return 0;
  }

  const quantity = notionalUsd / entry;
  return perf.trade.side === "sell" ? -quantity : quantity;
}

function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) {
    return "--";
  }

  const sign = quantity < 0 ? "-" : "";
  return `${sign}${Math.abs(quantity).toFixed(2)}`;
}

function computePnl(perf: SetupReviewPerformance): { notionalUsd: number; pct: number | null; usd: number | null } {
  const notionalUsd = assumedNotionalUsd(perf);
  if (notionalUsd === 0) {
    return { notionalUsd, pct: null, usd: null };
  }

  const pct = pnlPctFor(perf);
  if (pct == null || !Number.isFinite(pct)) {
    return { notionalUsd, pct: null, usd: null };
  }

  return { notionalUsd, pct, usd: (pct / 100) * notionalUsd };
}

function toEpochMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function laterDate(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  const aTime = toEpochMs(a);
  const bTime = toEpochMs(b);

  if (aTime == null && bTime == null) {
    return null;
  }

  if (aTime == null) {
    return b;
  }

  if (bTime == null) {
    return a;
  }

  return aTime >= bTime ? a : b;
}

function earlierDate(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  const aTime = toEpochMs(a);
  const bTime = toEpochMs(b);

  if (aTime == null && bTime == null) {
    return null;
  }

  if (aTime == null) {
    return b;
  }

  if (bTime == null) {
    return a;
  }

  return aTime <= bTime ? a : b;
}

function finalizedAt(perf: SetupReviewPerformance): string | null {
  return laterDate(perf.tp2At, perf.stopAt);
}

type AggregatedPosition = {
  symbol: string;
  reportDate: string;
  quantity: number;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  pnl: {
    investedUsd: number;
    pnlUsd: number;
    pnlPct: number | null;
  };
};

function aggregateOpenPositionsBySymbol(rows: OpenedSetupReviewPerformance[]): AggregatedPosition[] {
  const bySymbol = new Map<string, OpenedSetupReviewPerformance[]>();

  for (const perf of rows) {
    const existing = bySymbol.get(perf.symbol);
    if (existing) {
      existing.push(perf);
    } else {
      bySymbol.set(perf.symbol, [perf]);
    }
  }

  const aggregated: AggregatedPosition[] = [];
  for (const [symbol, items] of bySymbol) {
    let reportDate = items[0].setupDate;
    let quantity = 0;
    let firstTradeAt: string | null = null;
    let lastTradeAt: string | null = null;

    for (const item of items) {
      if (item.setupDate > reportDate) {
        reportDate = item.setupDate;
      }

      quantity += assumedQuantity(item);
      firstTradeAt = earlierDate(firstTradeAt, item.openedAt);
      lastTradeAt = laterDate(lastTradeAt, item.openedAt);
    }

    aggregated.push({ symbol, reportDate, quantity, firstTradeAt, lastTradeAt, pnl: aggregate(items) });
  }

  aggregated.sort((a, b) => {
    const aTime = toEpochMs(a.lastTradeAt);
    const bTime = toEpochMs(b.lastTradeAt);

    if (aTime == null && bTime == null) {
      return a.symbol.localeCompare(b.symbol);
    }

    if (aTime == null) {
      return 1;
    }

    if (bTime == null) {
      return -1;
    }

    return bTime - aTime || a.symbol.localeCompare(b.symbol);
  });

  return aggregated;
}

function aggregateClosedPositionsBySymbol(rows: OpenedSetupReviewPerformance[]): AggregatedPosition[] {
  const bySymbol = new Map<string, OpenedSetupReviewPerformance[]>();

  for (const perf of rows) {
    const existing = bySymbol.get(perf.symbol);
    if (existing) {
      existing.push(perf);
    } else {
      bySymbol.set(perf.symbol, [perf]);
    }
  }

  const aggregated: AggregatedPosition[] = [];
  for (const [symbol, items] of bySymbol) {
    let reportDate = items[0].setupDate;
    let quantity = 0;
    let firstTradeAt: string | null = null;
    let lastTradeAt: string | null = null;

    for (const item of items) {
      if (item.setupDate > reportDate) {
        reportDate = item.setupDate;
      }

      quantity += assumedQuantity(item);
      firstTradeAt = earlierDate(firstTradeAt, item.openedAt);
      lastTradeAt = laterDate(lastTradeAt, finalizedAt(item));
    }

    aggregated.push({ symbol, reportDate, quantity, firstTradeAt, lastTradeAt, pnl: aggregate(items) });
  }

  aggregated.sort((a, b) => {
    const aTime = toEpochMs(a.lastTradeAt);
    const bTime = toEpochMs(b.lastTradeAt);

    if (aTime == null && bTime == null) {
      return a.symbol.localeCompare(b.symbol);
    }

    if (aTime == null) {
      return 1;
    }

    if (bTime == null) {
      return -1;
    }

    return bTime - aTime || a.symbol.localeCompare(b.symbol);
  });

  return aggregated;
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
    if (!hasOpenedAt(p)) {
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

  open.sort((a, b) => {
    const aTime = toEpochMs(a.openedAt);
    const bTime = toEpochMs(b.openedAt);

    if (aTime == null && bTime == null) {
      return a.symbol.localeCompare(b.symbol);
    }

    if (aTime == null) {
      return 1;
    }

    if (bTime == null) {
      return -1;
    }

    return bTime - aTime || a.symbol.localeCompare(b.symbol);
  });
  closed.sort(compareClosedPositions);

  return { open, closed, ignored: { pending, notOpened } };
}

function compareClosedPositions(a: OpenedSetupReviewPerformance, b: OpenedSetupReviewPerformance): number {
  const aFinal = finalizedAt(a);
  const bFinal = finalizedAt(b);
  const aTime = toEpochMs(aFinal);
  const bTime = toEpochMs(bFinal);

  if (aTime == null && bTime == null) {
    const aOpenedTime = toEpochMs(a.openedAt);
    const bOpenedTime = toEpochMs(b.openedAt);

    if (aOpenedTime != null && bOpenedTime != null && bOpenedTime !== aOpenedTime) {
      return bOpenedTime - aOpenedTime;
    }

    return a.symbol.localeCompare(b.symbol);
  }

  if (aTime == null) {
    return 1;
  }

  if (bTime == null) {
    return -1;
  }

  if (bTime !== aTime) {
    return bTime - aTime;
  }

  const aOpenedTime = toEpochMs(a.openedAt);
  const bOpenedTime = toEpochMs(b.openedAt);
  if (aOpenedTime != null && bOpenedTime != null && bOpenedTime !== aOpenedTime) {
    return bOpenedTime - aOpenedTime;
  }

  return a.symbol.localeCompare(b.symbol);
}

function aggregate(items: SetupReviewPerformance[]): {
  investedUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
} {
  let investedUsd = 0;
  let pnlUsd = 0;

  for (const perf of items) {
    const pnl = computePnl(perf);
    if (pnl.notionalUsd === 0 || pnl.usd == null) {
      continue;
    }

    investedUsd += pnl.notionalUsd;
    pnlUsd += pnl.usd;
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
  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return parts.join(" and ");
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function getAggregatePnlDisplay(agg: {
  investedUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
}): { className: string; pctLabel: string; usdLabel: string } {
  if (agg.investedUsd === 0 || agg.pnlPct == null) {
    return { className: styles.pnlNeutral, pctLabel: "--", usdLabel: "--" };
  }

  const pnlPct = agg.pnlPct;
  const pnlUsd = agg.pnlUsd;

  const className =
    pnlPct > 0 ? styles.pnlPositive : pnlPct < 0 ? styles.pnlNegative : styles.pnlNeutral;

  return {
    className,
    pctLabel: formatSignedPct(pnlPct),
    usdLabel: formatSignedUsd(pnlUsd)
  };
}

function AggregatedPositionRow({ position }: { position: AggregatedPosition }) {
  const pnl = getAggregatePnlDisplay(position.pnl);

  return (
    <tr>
      <td>
        <Link href={`/reports/${position.reportDate}`}>
          <strong>{position.symbol}</strong>
        </Link>
      </td>
      <td>{formatQuantity(position.quantity)}</td>
      <td>{formatIsoDate(position.firstTradeAt)}</td>
      <td>{formatIsoDate(position.lastTradeAt)}</td>
      <td className={pnl.className}>{pnl.pctLabel}</td>
      <td className={pnl.className}>{pnl.usdLabel}</td>
    </tr>
  );
}

function renderOpenTable(rows: AggregatedPosition[]) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Quantity</th>
            <th>First trade</th>
            <th>Last trade</th>
            <th>P&amp;L %</th>
            <th>P&amp;L $</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <AggregatedPositionRow key={p.symbol} position={p} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderClosedTable(rows: AggregatedPosition[]) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Quantity</th>
            <th>First trade</th>
            <th>Last trade</th>
            <th>P&amp;L %</th>
            <th>P&amp;L $</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <AggregatedPositionRow key={p.symbol} position={p} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PortfolioPage() {
  const listed = await listSetupReviewPerformances();
  const all = listed.map((l) => l.performance);

  const { open, closed, ignored } = splitPositions(all);
  const openPositions = aggregateOpenPositionsBySymbol(open);
  const closedPositions = aggregateClosedPositionsBySymbol(closed);
  const totalTickers = new Set([...openPositions.map((p) => p.symbol), ...closedPositions.map((p) => p.symbol)]).size;

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
            Aggregated positions by symbol (assumes a normalized ${"$" + ASSUMED_SETUP_NOTIONAL_USD.toFixed(0)} notional per opened setup; quantity
            is derived from the entry price).
          </p>
        </div>
        <Link className={styles.homeLink} href="/">
          Home
        </Link>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Open</div>
          <div className={styles.summaryValue}>{openPositions.length}</div>
          <div className="report-muted">{formatSummaryPnl(openAgg)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Closed</div>
          <div className={styles.summaryValue}>{closedPositions.length}</div>
          <div className="report-muted">{formatSummaryPnl(closedAgg)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Total</div>
          <div className={styles.summaryValue}>{totalTickers}</div>
          <div className="report-muted">{formatSummaryPnl(totalAgg)}</div>
        </div>
      </div>

      {ignoredParts.length > 0 ? (
        <p className="report-muted">Ignoring {joinWithAnd(ignoredParts)} from portfolio stats because they have no open date.</p>
      ) : null}

      {openPositions.length > 0 ? (
        <>
          <h2>Open</h2>
          {renderOpenTable(openPositions)}
        </>
      ) : (
        <p className="report-muted">No open positions.</p>
      )}

      {closedPositions.length > 0 ? (
        <>
          <h2>Closed</h2>
          {renderClosedTable(closedPositions)}
        </>
      ) : null}
    </>
  );
}
