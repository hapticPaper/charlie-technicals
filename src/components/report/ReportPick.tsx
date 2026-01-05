import type { ReportIntervalSeries, ReportPick as ReportPickSetup, TradePlan } from "../../market/types";
import { ReportChart } from "./ReportChart";
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

/**
* Renders a single trade/watchlist setup from a report.
*
* This component is used via the report MDX renderer, which is responsible for validating and
* slicing the report payload before rendering.
*
* Symbol-specific diagnostics and fallback copy live at the MDX wiring layer.
*/
export function ReportPick(props: {
  setup: ReportPickSetup;
  setupType: "pick" | "watchlist" | "both";
  series1d: ReportIntervalSeries;
  series15m: ReportIntervalSeries;
}) {
  const { setup, setupType, series1d, series15m } = props;
  if (process.env.NODE_ENV !== "production") {
    if (series1d == null || series15m == null) {
      console.error("[reports] ReportPick rendered with missing series (MDX wiring bug)", {
        symbol: setup.symbol,
        has1d: series1d != null,
        has15m: series15m != null
      });
    }
  }

  if (series1d == null || series15m == null) {
    return <p>Missing price series data for {setup.symbol} (cannot render report charts).</p>;
  }

  const setupTypeLabel =
    setupType === "both" ? "Trade (also on Watchlist)" : setupType === "watchlist" ? "Watchlist" : "Trade";

  const formatted = formatTrade(setup.trade);
  const isBuy = setup.trade.side === "buy";
  const hasNarrative = typeof setup.narrative === "string" && setup.narrative.trim() !== "";

  return (
    <section className={styles.pick}>
      <div className={styles.pickHeader}>
        <div className={styles.badges}>
          <span className={isBuy ? styles.badgeBuy : styles.badgeSell}>{formatted.sideLabel}</span>
          <span className={styles.badgeNeutral}>{setupTypeLabel}</span>
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

      {hasNarrative ? (
        <p className={styles.pickNarrative}>{setup.narrative}</p>
      ) : null}

      {setup.rationale.length > 0 ? (
        hasNarrative ? (
          <details className={styles.pickDetails}>
            <summary>Details</summary>
            <ul className={styles.rationale}>
              {setup.rationale.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
          </details>
        ) : (
          <ul className={styles.rationale}>
            {setup.rationale.map((r, idx) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        )
      ) : null}

      <div className={styles.charts}>
        <ReportChart title="1d" series={series1d} annotations={{ trade: setup.trade }} />
        <ReportChart title="15m" series={series15m} annotations={{ trade: setup.trade }} />
      </div>
    </section>
  );
}
