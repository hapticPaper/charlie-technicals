"use client";

import {
  coerceRiskTone,
  REPORT_MAX_PICKS,
  REPORT_MAX_WATCHLIST,
  type MarketReport,
  type RiskTone
} from "../../market/types";
import { useReport } from "./ReportProvider";
import styles from "./report.module.css";

const MOST_ACTIVE_DAY_VISIBLE = 5;
const MOST_ACTIVE_WEEK_VISIBLE = 5;

type MostActiveDayEntry = NonNullable<MarketReport["mostActive"]>["byDollarVolume1d"][number];
type MostActiveWeekEntry = NonNullable<MarketReport["mostActive"]>["byDollarVolume5d"][number];

function formatDollarsCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) {
    return `${(value / 1e12).toFixed(2)}T`;
  }
  if (abs >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  }
  if (abs >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  if (abs >= 1e3) {
    return `${(value / 1e3).toFixed(2)}K`;
  }
  return value.toFixed(0);
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function getStructuredSentiment(report: MarketReport): { tone: RiskTone; lines: string[] } | null {
  const structured = report.summaries.sentiment;
  const structuredTone = coerceRiskTone(structured?.tone);
  const structuredLines = Array.isArray(structured?.lines)
    ? structured.lines
        .map((line) => (typeof line === "string" ? line.trim() : ""))
        .filter(Boolean)
    : [];

  return structured && structuredLines.length > 0 ? { tone: structuredTone, lines: structuredLines } : null;
}

// Legacy compatibility fallback for older persisted reports that don't have structured sentiment.
function getNarrativeSentiment(report: MarketReport, preferredTone: RiskTone | null): { tone: RiskTone; lines: string[] } | null {
  const rawMainIdea = typeof report.summaries.mainIdea === "string" ? report.summaries.mainIdea : "";
  const mainIdea = rawMainIdea.trim();
  if (!mainIdea) {
    return null;
  }

  const sentences = mainIdea
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const firstSentence = sentences.at(0) ?? "";
  const toneFromNarrative = firstSentence.match(/\brisk-(?:on|off)\b|\bmixed\b/i)?.[0] ?? null;

  const lines: string[] = [];
  const colonIdx = firstSentence.indexOf(":");
  if (colonIdx !== -1) {
    const afterColon = firstSentence.slice(colonIdx + 1).replace(/\.$/, "").trim();
    if (afterColon) {
      lines.push(
        ...afterColon
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      );
    }
  }

  const volatilitySentence = sentences.find((sentence) => {
    const lower = sentence.toLowerCase();
    return lower.startsWith("volatility") || lower.includes(" volatility ");
  });
  if (volatilitySentence) {
    lines.push(volatilitySentence.replace(/\.$/, ""));
  }

  if (lines.length === 0) {
    lines.push(...sentences.slice(0, 2).map((sentence) => sentence.replace(/\.$/, "")));
  }

  const trimmed = lines.slice(0, 3);
  if (trimmed.length === 0) {
    return null;
  }

  return {
    tone: preferredTone ?? coerceRiskTone(toneFromNarrative),
    lines: trimmed
  };
}

function extractSentiment(report: MarketReport): { tone: RiskTone; lines: string[] } | null {
  const structuredTone = report.summaries.sentiment ? coerceRiskTone(report.summaries.sentiment.tone) : null;
  return getStructuredSentiment(report) ?? getNarrativeSentiment(report, structuredTone);
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

function renderMostActiveDayRow(entry: MostActiveDayEntry, keyPrefix: string) {
  const bias = entry.trendBias1d === "buy" ? "bullish" : entry.trendBias1d === "sell" ? "bearish" : "neutral";
  const moveLabel =
    typeof entry.change1dPct === "number" && Number.isFinite(entry.change1dPct) ? formatSignedPct(entry.change1dPct) : "";
  const atrLabel =
    typeof entry.change1dAtr14 === "number" && Number.isFinite(entry.change1dAtr14)
      ? ` (${Math.abs(entry.change1dAtr14).toFixed(1)} ATR)`
      : "";

  return (
    <li key={`${keyPrefix}-${entry.symbol}`}>
      <strong>{entry.symbol}</strong>: {bias} | {`$${formatDollarsCompact(entry.dollarVolume1d)}`} | {moveLabel}
      {atrLabel}
    </li>
  );
}

function renderMostActiveWeekRow(entry: MostActiveWeekEntry, keyPrefix: string) {
  return (
    <li key={`${keyPrefix}-${entry.symbol}`}>
      <strong>{entry.symbol}</strong>: {`$${formatDollarsCompact(entry.dollarVolume5d)}`}
    </li>
  );
}

export function ReportSummary() {
  const report = useReport();
  const sentiment = extractSentiment(report);
  const tone = sentiment?.tone ?? "mixed";
  const sentimentLines = sentiment?.lines ?? [];
  const picks = Array.isArray(report.picks) ? report.picks : [];
  const visiblePicks = picks.slice(0, REPORT_MAX_PICKS);
  const hasMorePicks = picks.length > visiblePicks.length;
  const mostActiveDay = report.mostActive?.byDollarVolume1d ?? [];
  const mostActiveWeek = report.mostActive?.byDollarVolume5d ?? [];
  const mostActiveTopCount = Math.min(MOST_ACTIVE_DAY_VISIBLE, mostActiveDay.length);

  return (
    <section className={styles.summary}>
      <div className={styles.narrative}>
        <p className={styles.narrativeMain}>{report.summaries.mainIdea}</p>
        <p className="report-muted">{report.summaries.veryShort}</p>
      </div>

      <div className={styles.widgetGrid}>
        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>Market sentiment</h3>
            {sentiment ? <span className={toneBadgeClass(tone)}>{RISK_TONE_LABEL[tone]}</span> : null}
          </div>

          {sentimentLines.length > 0 ? (
            <ul className={styles.widgetList}>
              {sentimentLines.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="report-muted">No sentiment readout available.</p>
          )}
        </section>

        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>Technical trades</h3>
            <span className={styles.widgetCount}>{picks.length}</span>
          </div>

          {visiblePicks.length > 0 ? (
            <ul className={styles.widgetList}>
              {visiblePicks.map((p) => (
                <li key={`pick-${p.symbol}`}>
                  <strong>{p.symbol}</strong>: {p.trade.side.toUpperCase()} {p.trade.entry.toFixed(2)} / stop {p.trade.stop.toFixed(2)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-muted">No technical trades met the filter today.</p>
          )}

          {hasMorePicks ? (
            <p className="report-muted">Showing first {visiblePicks.length}.</p>
          ) : null}
        </section>

        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>Watchlist</h3>
            <span className={styles.widgetCount}>{report.watchlist?.length ?? 0}</span>
          </div>

          {report.watchlist?.length ? (
            <ul className={styles.widgetList}>
              {report.watchlist.slice(0, REPORT_MAX_WATCHLIST).map((p) => (
                <li key={`watch-${p.symbol}`}>
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
        </section>

        <section className={styles.widget}>
          <div className={styles.widgetHeader}>
            <h3 className={styles.widgetTitle}>
              Most active{mostActiveTopCount > 0 ? ` (top ${mostActiveTopCount})` : ""}
            </h3>
          </div>

          {mostActiveDay.length > 0 ? (
            <>
              <p className={styles.widgetMuted}>
                <strong>Last day</strong>
              </p>
              <ul className={styles.widgetList}>
                {mostActiveDay.slice(0, MOST_ACTIVE_DAY_VISIBLE).map((entry) => renderMostActiveDayRow(entry, "day"))}
              </ul>

              {mostActiveDay.length > MOST_ACTIVE_DAY_VISIBLE || mostActiveWeek.length > 0 ? (
                <details className={styles.widgetDetails}>
                  <summary className="report-muted">More</summary>

                  {mostActiveDay.length > MOST_ACTIVE_DAY_VISIBLE ? (
                    <>
                      <p className={styles.widgetMuted}>
                        <strong>
                          Last day ({MOST_ACTIVE_DAY_VISIBLE + 1}–{mostActiveDay.length})
                        </strong>
                      </p>
                      <ul className={styles.widgetList}>
                        {mostActiveDay
                          .slice(MOST_ACTIVE_DAY_VISIBLE)
                          .map((entry) => renderMostActiveDayRow(entry, "day-more"))}
                      </ul>
                    </>
                  ) : null}

                  {mostActiveWeek.length > 0 ? (
                    <>
                      <p className={styles.widgetMuted}>
                        <strong>Last week</strong>
                      </p>
                      <ul className={styles.widgetList}>
                        {mostActiveWeek
                          .slice(0, MOST_ACTIVE_WEEK_VISIBLE)
                          .map((entry) => renderMostActiveWeekRow(entry, "week"))}
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
        <pre>{report.summaries.summary}</pre>
      </details>
    </section>
  );
}
