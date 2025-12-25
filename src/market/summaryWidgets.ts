import {
  REPORT_MAX_PICKS,
  REPORT_MAX_WATCHLIST,
  coerceRiskTone,
  type MarketReport,
  type MarketReportSummaryMostActive,
  type MarketReportSummaryMostActiveRow,
  type MarketReportSummaryPick,
  type MarketReportSummarySentiment,
  type MarketReportSummarySentimentLine,
  type MarketReportSummaryWatchlistEntry,
  type MarketReportSummaryWidgets
} from "./types";

const MOST_ACTIVE_DAY_VISIBLE = 5;
const MOST_ACTIVE_WEEK_VISIBLE = 5;

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

function buildSentimentLineKeys(lines: string[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const count = seen.get(line) ?? 0;
    seen.set(line, count + 1);
    return count === 0 ? line : `${line}-${count}`;
  });
}

function toSentimentLines(lines: string[]): MarketReportSummarySentimentLine[] {
  const trimmed = lines
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
  const keys = buildSentimentLineKeys(trimmed);
  return trimmed.map((text, idx) => ({ key: keys[idx] ?? String(idx), text }));
}

function getStructuredSentiment(report: MarketReport): MarketReportSummarySentiment | null {
  const structured = report.summaries.sentiment;
  if (!structured) {
    return null;
  }

  const lines = Array.isArray(structured.lines) ? toSentimentLines(structured.lines) : [];
  if (lines.length === 0) {
    return null;
  }

  return {
    tone: coerceRiskTone(structured.tone),
    lines
  };
}

function getMostActive(report: MarketReport): MarketReportSummaryMostActive | null {
  const mostActiveDay = report.mostActive?.byDollarVolume1d ?? [];
  const mostActiveWeek = report.mostActive?.byDollarVolume5d ?? [];

  if (mostActiveDay.length === 0 && mostActiveWeek.length === 0) {
    return null;
  }

  function toDayRow(entry: (typeof mostActiveDay)[number], idx: number): MarketReportSummaryMostActiveRow {
    const bias = entry.trendBias1d === "buy" ? "bullish" : entry.trendBias1d === "sell" ? "bearish" : "neutral";
    const moveLabel =
      typeof entry.change1dPct === "number" && Number.isFinite(entry.change1dPct)
        ? formatSignedPct(entry.change1dPct)
        : null;
    const atrLabel =
      typeof entry.change1dAtr14 === "number" && Number.isFinite(entry.change1dAtr14)
        ? `(${Math.abs(entry.change1dAtr14).toFixed(1)} ATR)`
        : null;

    return {
      key: `day-${idx}-${entry.symbol}`,
      symbol: entry.symbol,
      bias,
      dollarVolumeLabel: `$${formatDollarsCompact(entry.dollarVolume1d)}`,
      moveLabel,
      atrLabel
    };
  }

  function toWeekRow(entry: (typeof mostActiveWeek)[number], idx: number): MarketReportSummaryMostActiveRow {
    return {
      key: `week-${idx}-${entry.symbol}`,
      symbol: entry.symbol,
      bias: "neutral",
      dollarVolumeLabel: `$${formatDollarsCompact(entry.dollarVolume5d)}`,
      moveLabel: null,
      atrLabel: null
    };
  }

  const dayVisibleCount = Math.min(MOST_ACTIVE_DAY_VISIBLE, mostActiveDay.length);
  const dayTop = mostActiveDay.slice(0, dayVisibleCount).map(toDayRow);
  const dayOverflow = mostActiveDay.slice(dayVisibleCount).map((entry, idx) => toDayRow(entry, dayVisibleCount + idx));
  const weekTop = mostActiveWeek
    .slice(0, MOST_ACTIVE_WEEK_VISIBLE)
    .map(toWeekRow);

  return {
    day: {
      total: mostActiveDay.length,
      visibleCount: dayVisibleCount,
      top: dayTop,
      overflow: dayOverflow
    },
    week: {
      total: mostActiveWeek.length,
      top: weekTop
    }
  };
}

export function buildReportSummaryWidgets(report: MarketReport): MarketReportSummaryWidgets {
  const picks = Array.isArray(report.picks) ? report.picks : [];
  const watchlist = Array.isArray(report.watchlist) ? report.watchlist : [];

  const previewPicks: MarketReportSummaryPick[] = picks.slice(0, REPORT_MAX_PICKS).map((p, idx) => ({
    key: `pick-${idx}-${p.symbol}`,
    symbol: p.symbol,
    trade: {
      side: p.trade.side,
      entry: p.trade.entry,
      stop: p.trade.stop
    }
  }));

  const previewWatchlist: MarketReportSummaryWatchlistEntry[] = watchlist
    .slice(0, REPORT_MAX_WATCHLIST)
    .map((p, idx) => ({
      key: `watch-${idx}-${p.symbol}`,
      symbol: p.symbol,
      trade: { side: p.trade.side },
      basis: p.basis ?? null,
      move1dAtr14:
        typeof p.move1dAtr14 === "number" && Number.isFinite(p.move1dAtr14) ? p.move1dAtr14 : null
    }));

  return {
    version: "v1-summary-widgets",
    narrative: {
      mainIdea: report.summaries.mainIdea,
      veryShort: report.summaries.veryShort
    },
    sentiment: getStructuredSentiment(report),
    technicalTrades: {
      total: picks.length,
      preview: previewPicks,
      hasMore: picks.length > previewPicks.length
    },
    watchlist: {
      total: watchlist.length,
      preview: previewWatchlist,
      hasMore: watchlist.length > previewWatchlist.length
    },
    mostActive: getMostActive(report),
    fullContext: report.summaries.summary
  };
}
