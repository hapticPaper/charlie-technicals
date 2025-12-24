"use client";

import type { MarketInterval, TradePlan } from "../../market/types";
import { ReportChart } from "./ReportChart";
import { useReport } from "./ReportProvider";
import styles from "./report.module.css";

function formatPrice(value: number, reference: number): string {
  const abs = Math.abs(reference);
  if (abs >= 100) {
    return value.toFixed(2);
  }
  if (abs >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(5);
}

function formatSignedPrice(value: number, reference: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatPrice(value, reference)}`;
}

function formatTrade(trade: TradePlan): {
  sideLabel: string;
  entry: string;
  stop: string;
  targets: string[];
} {
  return {
    sideLabel: trade.side === "buy" ? "Buy" : "Sell",
    entry: formatPrice(trade.entry, trade.entry),
    stop: formatPrice(trade.stop, trade.entry),
    targets: trade.targets.map((t) => formatPrice(t, trade.entry))
  };
}

function mustGetSeries(report: ReturnType<typeof useReport>, symbol: string, interval: MarketInterval) {
  const series = report.series[symbol]?.[interval];
  if (!series) {
    throw new Error(`Missing series in report for ${symbol} ${interval}`);
  }

  return series;
}

export function ReportPick(props: { symbol: string }) {
  const report = useReport();
  const pick = report.picks.find((p) => p.symbol === props.symbol);
  const watch = report.watchlist?.find((p) => p.symbol === props.symbol);
  const setup = pick ?? watch;
  if (!setup) {
    return <p>Missing setup data for {props.symbol}.</p>;
  }

  const formatted = formatTrade(setup.trade);
  const isBuy = setup.trade.side === "buy";

  let series1d;
  let series15m;
  try {
    series1d = mustGetSeries(report, props.symbol, "1d");
    series15m = mustGetSeries(report, props.symbol, "15m");
  } catch {
    return <p>Missing series for pick.</p>;
  }

  return (
    <section className={styles.pick}>
      <div className={styles.pickHeader}>
        <div className={styles.badges}>
          <span className={isBuy ? styles.badgeBuy : styles.badgeSell}>{formatted.sideLabel}</span>
          {pick ? <span className={styles.badgeNeutral}>Trade</span> : <span className={styles.badgeNeutral}>Watchlist</span>}
          <span className={styles.badgeNeutral}>Score {setup.score}</span>
        </div>
        <div className={styles.tradeSummary}>
          Entry {formatted.entry} | Stop {formatted.stop}
        </div>
      </div>

      <div className={styles.tradeGrid}>
        <div className={styles.kv}>
          <div className={styles.kLabel}>Entry</div>
          <div className={styles.kValue}>{formatted.entry}</div>
        </div>
        <div className={styles.kv}>
          <div className={styles.kLabel}>Stop</div>
          <div className={styles.kValue}>{formatted.stop}</div>
        </div>
        <div className={styles.kv}>
          <div className={styles.kLabel}>Targets</div>
          <div className={styles.kValue}>{formatted.targets.join(" / ")}</div>
        </div>

        {typeof setup.atr14_1d === "number" && Number.isFinite(setup.atr14_1d) ? (
          <div className={styles.kv}>
            <div className={styles.kLabel}>ATR14 (1d)</div>
            <div className={styles.kValue}>{formatPrice(setup.atr14_1d, setup.trade.entry)}</div>
          </div>
        ) : null}
        {typeof setup.move1d === "number" && Number.isFinite(setup.move1d) ? (
          <div className={styles.kv}>
            <div className={styles.kLabel}>1d move</div>
            <div className={styles.kValue}>
              {formatSignedPrice(setup.move1d, setup.trade.entry)}
              {typeof setup.move1dAtr14 === "number" && Number.isFinite(setup.move1dAtr14)
                ? ` (${Math.abs(setup.move1dAtr14).toFixed(1)} ATR)`
                : ""}
            </div>
          </div>
        ) : null}
      </div>

      {setup.rationale.length > 0 ? (
        <ul className={styles.rationale}>
          {setup.rationale.map((r, idx) => (
            <li key={idx}>{r}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.charts}>
        <ReportChart title="1d" series={series1d} annotations={{ trade: setup.trade }} />
        <ReportChart title="15m" series={series15m} annotations={{ trade: setup.trade }} />
      </div>
    </section>
  );
}
