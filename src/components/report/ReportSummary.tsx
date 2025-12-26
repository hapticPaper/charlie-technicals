"use client";

import {
  type MarketReportSummaryMostActiveRow,
  type MarketReportSummaryWidgets,
  type RiskTone
} from "../../market/types";
import { buildReportSummaryWidgets } from "../../market/summaryWidgets";
import { useReport } from "./ReportProvider";
import styles from "./report.module.css";

function isMarketReportSummaryWidgets(value: unknown): value is MarketReportSummaryWidgets {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { version?: unknown };
  return candidate.version === "v1-summary-widgets";
}

function toneBadgeClass(tone: RiskTone): string {
  if (tone === "risk-on") {
    return styles.badgeBuy;
  }
  if (tone === "risk-off") {
    return styles.badgeSell;
  }
  return styles.badgeNeutral;
}

const RISK_TONE_LABEL: Record<RiskTone, string> = {
  "risk-on": "Risk-on",
  "risk-off": "Risk-off",
  mixed: "Mixed"
};

function renderMostActiveDayRow(row: MarketReportSummaryMostActiveRow) {
  return (
    <li key={row.key}>
      <strong>{row.symbol}</strong>: {row.bias} | {row.dollarVolumeLabel}
      {row.moveLabel ? ` | ${row.moveLabel}` : ""}
      {row.atrLabel ? ` ${row.atrLabel}` : ""}
    </li>
  );
}

function renderMostActiveWeekRow(row: MarketReportSummaryMostActiveRow) {
  return (
    <li key={row.key}>
      <strong>{row.symbol}</strong>: {row.dollarVolumeLabel}
    </li>
  );
}

type ReportSummaryProps = {
  summary?: unknown;
};

export function ReportSummary(props: ReportSummaryProps) {
  const report = useReport();
  const summary = isMarketReportSummaryWidgets(props.summary)
    ? props.summary
    : buildReportSummaryWidgets(report);

  const sentimentTone = summary.sentiment?.tone ?? "mixed";
  const sentimentLines = summary.sentiment?.lines ?? [];
  const mostActive = summary.mostActive;
  const mostActiveTopCount = mostActive?.day.visibleCount ?? 0;

  return (
    <section className={styles.summary}>
      <div className={styles.narrative}>
        <p className={styles.narrativeMain}>{summary.narrative.mainIdea}</p>
        <p className="report-muted">{summary.narrative.veryShort}</p>
      </div>

      <div className={styles.widgetGrid}>
        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>Market sentiment</h3>
            {summary.sentiment ? (
              <span className={toneBadgeClass(sentimentTone)}>{RISK_TONE_LABEL[sentimentTone]}</span>
            ) : null}
          </div>

          {sentimentLines.length > 0 ? (
            <ul className={styles.widgetList}>
              {sentimentLines.map((line) => (
                <li key={line.key}>{line.text}</li>
              ))}
            </ul>
          ) : (
            <p className="report-muted">No sentiment readout available.</p>
          )}
        </section>

        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>Technical trades</h3>
            <span className={styles.widgetCount}>{summary.technicalTrades.total}</span>
          </div>

          {summary.technicalTrades.preview.length > 0 ? (
            <ul className={styles.widgetList}>
              {summary.technicalTrades.preview.map((p) => (
                <li key={p.key}>
                  <strong>{p.symbol}</strong>: {p.trade.side.toUpperCase()} {p.trade.entry.toFixed(2)} / stop {p.trade.stop.toFixed(2)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-muted">No technical trades met the filter today.</p>
          )}

          {summary.technicalTrades.hasMore ? (
            <p className="report-muted">Showing first {summary.technicalTrades.preview.length}.</p>
          ) : null}
        </section>

        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>Watchlist</h3>
            <span className={styles.widgetCount}>{summary.watchlist.total}</span>
          </div>

          {summary.watchlist.preview.length > 0 ? (
            <ul className={styles.widgetList}>
              {summary.watchlist.preview.map((p) => (
                <li key={p.key}>
                  <strong>{p.symbol}</strong>: {p.trade.side.toUpperCase()}
                  {p.basis === "trend" ? " [trend]" : p.basis === "signal" ? " [sub-ATR signal]" : ""}
                  {typeof p.move1dAtr14 === "number" && Number.isFinite(p.move1dAtr14)
                    ? ` | ${Math.abs(p.move1dAtr14).toFixed(1)} ATR`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-muted">No watchlist names stood out today.</p>
          )}

          {summary.watchlist.hasMore ? (
            <p className="report-muted">Showing first {summary.watchlist.preview.length}.</p>
          ) : null}
        </section>

        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>
              Most active{mostActiveTopCount > 0 ? ` (top ${mostActiveTopCount})` : ""}
            </h3>
          </div>

          {mostActive?.day.top.length ? (
            <>
              <p className={styles.widgetMuted}>
                <strong>Last day</strong>
              </p>
              <ul className={styles.widgetList}>
                {mostActive.day.top.map(renderMostActiveDayRow)}
              </ul>

              {mostActive.day.overflow.length > 0 || mostActive.week.top.length > 0 ? (
                <details className={styles.widgetDetails}>
                  <summary className="report-muted">More</summary>

                  {mostActive.day.overflow.length > 0 ? (
                    <>
                      <p className={styles.widgetMuted}>
                        <strong>
                          Last day ({mostActive.day.visibleCount + 1}–{mostActive.day.total})
                        </strong>
                      </p>
                      <ul className={styles.widgetList}>
                        {mostActive.day.overflow.map(renderMostActiveDayRow)}
                      </ul>
                    </>
                  ) : null}

                  {mostActive.week.top.length > 0 ? (
                    <>
                      <p className={styles.widgetMuted}>
                        <strong>Last week</strong>
                      </p>
                      <ul className={styles.widgetList}>
                        {mostActive.week.top.map(renderMostActiveWeekRow)}
                      </ul>
                    </>
                  ) : null}
                </details>
              ) : null}
            </>
          ) : (
            <p className="report-muted">Most-active data unavailable.</p>
          )}
        </section>
      </div>

      <details className={styles.contextDetails}>
        <summary className="report-muted">Full context</summary>
        <pre>{summary.fullContext}</pre>
      </details>
    </section>
  );
}
