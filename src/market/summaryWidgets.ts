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

export function isMarketReportSummaryWidgets(value: unknown): value is MarketReportSummaryWidgets {
  const isObject = (candidate: unknown): candidate is Record<string, unknown> =>
    !!candidate && typeof candidate === "object";

  const isFiniteNumber = (candidate: unknown): candidate is number =>
    typeof candidate === "number" && Number.isFinite(candidate);

  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MarketReportSummaryWidgets> & { version?: unknown };
  if (candidate.version !== "v1-summary-widgets") {
    return false;
  }

  const narrative = candidate.narrative as unknown;
  if (!isObject(narrative)) {
    return false;
  }

  const narrativeCandidate = narrative as { mainIdea?: unknown; veryShort?: unknown };
  if (typeof narrativeCandidate.mainIdea !== "string" || typeof narrativeCandidate.veryShort !== "string") {
    return false;
  }

  const technicalTrades = candidate.technicalTrades as unknown;
  if (!isObject(technicalTrades)) {
    return false;
  }

  const technicalTradesCandidate = technicalTrades as {
    total?: unknown;
    preview?: unknown;
    hasMore?: unknown;
  };
  if (!isFiniteNumber(technicalTradesCandidate.total)) {
    return false;
  }

  if (!Array.isArray(technicalTradesCandidate.preview) || typeof technicalTradesCandidate.hasMore !== "boolean") {
    return false;
  }

  for (const item of technicalTradesCandidate.preview) {
    if (!isObject(item)) {
      return false;
    }
    if (typeof item.key !== "string" || typeof item.symbol !== "string") {
      return false;
    }
    if (!isObject(item.trade) || typeof item.trade.side !== "string") {
      return false;
    }
  }

  const watchlist = candidate.watchlist as unknown;
  if (!isObject(watchlist)) {
    return false;
  }

  const watchlistCandidate = watchlist as {
    total?: unknown;
    preview?: unknown;
    hasMore?: unknown;
  };
  if (!isFiniteNumber(watchlistCandidate.total)) {
    return false;
  }
  if (!Array.isArray(watchlistCandidate.preview) || typeof watchlistCandidate.hasMore !== "boolean") {
    return false;
  }

  for (const item of watchlistCandidate.preview) {
    if (!isObject(item)) {
      return false;
    }
    if (typeof item.key !== "string" || typeof item.symbol !== "string") {
      return false;
    }
    if (!isObject(item.trade) || typeof item.trade.side !== "string") {
      return false;
    }
    if (item.basis !== null && item.basis !== "signal" && item.basis !== "trend") {
      return false;
    }
    if (item.move1dAtr14 !== null && !isFiniteNumber(item.move1dAtr14)) {
      return false;
    }
  }

  const sentiment = candidate.sentiment as unknown;
  if (sentiment !== null) {
    if (!isObject(sentiment)) {
      return false;
    }

    const sentimentCandidate = sentiment as { tone?: unknown; lines?: unknown };
    if (typeof sentimentCandidate.tone !== "string" || !Array.isArray(sentimentCandidate.lines)) {
      return false;
    }

    for (const item of sentimentCandidate.lines) {
      if (!isObject(item)) {
        return false;
      }
      if (typeof item.key !== "string" || typeof item.text !== "string") {
        return false;
      }
    }
  }

  const mostActive = candidate.mostActive as unknown;
  if (mostActive !== null) {
    if (!isObject(mostActive)) {
      return false;
    }

    const day = (mostActive as { day?: unknown }).day;
    const week = (mostActive as { week?: unknown }).week;
    if (!isObject(day) || !isObject(week)) {
      return false;
    }

    const dayCandidate = day as {
      total?: unknown;
      visibleCount?: unknown;
      top?: unknown;
      overflow?: unknown;
    };
    if (!isFiniteNumber(dayCandidate.total) || !isFiniteNumber(dayCandidate.visibleCount)) {
      return false;
    }
    if (!Array.isArray(dayCandidate.top) || !Array.isArray(dayCandidate.overflow)) {
      return false;
    }
    for (const row of [...dayCandidate.top, ...dayCandidate.overflow]) {
      if (!isObject(row)) {
        return false;
      }
      if (typeof row.key !== "string" || typeof row.symbol !== "string" || typeof row.dollarVolumeLabel !== "string") {
        return false;
      }
    }

    const weekCandidate = week as { total?: unknown; top?: unknown };
    if (!isFiniteNumber(weekCandidate.total) || !Array.isArray(weekCandidate.top)) {
      return false;
    }
    for (const row of weekCandidate.top) {
      if (!isObject(row)) {
        return false;
      }
      if (typeof row.key !== "string" || typeof row.symbol !== "string" || typeof row.dollarVolumeLabel !== "string") {
        return false;
      }
    }
  }

  const fullContext = candidate.fullContext as unknown;
  if (typeof fullContext !== "string") {
    return false;
  }

  return true;
}

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
