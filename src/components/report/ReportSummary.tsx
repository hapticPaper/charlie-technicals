"use client";

import { REPORT_MAX_WATCHLIST } from "../../market/types";
import { useReport } from "./ReportProvider";

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

export function ReportSummary() {
  const report = useReport();

  return (
    <section>
      <h2>Highlights</h2>

      {report.picks.length > 0 ? (
        <>
          <p className="report-muted">
            <strong>Technical trades:</strong>
          </p>
          <ul>
            {report.picks.map((p) => (
              <li key={p.symbol}>
                <strong>{p.symbol}</strong>: {p.trade.side.toUpperCase()} entry {p.trade.entry.toFixed(2)}, stop{" "}
                {p.trade.stop.toFixed(2)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {report.watchlist?.length ? (
        <>
          <h3>Watchlist</h3>
          <p className="report-muted">
            Trend-following or low-volatility names that didn’t meet the technical-trade filter.
          </p>
          <ul>
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
        </>
      ) : null}

      {report.mostActive?.byDollarVolume1d?.length ? (
        <>
          <h3>Most active (dollar volume)</h3>
          <p className="report-muted">
            Ranked by last daily bar close×volume (within this universe). Moves are shown in ATR14 when available.
          </p>

          <p className="report-muted">
            <strong>Last day</strong>
          </p>
          <ul>
            {report.mostActive.byDollarVolume1d.slice(0, 10).map((e) => {
              const bias = e.trendBias1d === "buy" ? "bullish" : e.trendBias1d === "sell" ? "bearish" : "neutral";
              const moveLabel =
                typeof e.change1dPct === "number" && Number.isFinite(e.change1dPct)
                  ? formatSignedPct(e.change1dPct)
                  : "";
              const atrLabel =
                typeof e.change1dAtr14 === "number" && Number.isFinite(e.change1dAtr14)
                  ? ` (${Math.abs(e.change1dAtr14).toFixed(1)} ATR)`
                  : "";

              return (
                <li key={`day-${e.symbol}`}>
                  <strong>{e.symbol}</strong>: {bias} | {`$${formatDollarsCompact(e.dollarVolume1d)}`} | {moveLabel}
                  {atrLabel}
                </li>
              );
            })}
          </ul>

          <p className="report-muted">
            <strong>Last week</strong>
          </p>
          <ul>
            {report.mostActive.byDollarVolume5d.slice(0, 10).map((e) => (
              <li key={`week-${e.symbol}`}>
                <strong>{e.symbol}</strong>: {`$${formatDollarsCompact(e.dollarVolume5d)}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p>
        <strong>Market:</strong> {report.summaries.mainIdea}
      </p>
      <p className="report-muted">
        <strong>Watchlist:</strong> {report.summaries.veryShort}
      </p>

      <details className="report-muted">
        <summary>Full context</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{report.summaries.summary}</pre>
      </details>
    </section>
  );
}
