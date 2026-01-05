import type {
  AnalyzedSeries,
  BollingerBandsSeries,
  KeltnerChannelsSeries,
  MarketBar,
  MarketInterval,
  MarketNewsSnapshot,
  MarketReport,
  MostActiveEntry,
  ReportPick,
  ReportIntervalSeries,
  SqueezeState,
  TtmSqueezeSeries
} from "./types";

import { coerceRiskTone, REPORT_MAX_PICKS, REPORT_MAX_WATCHLIST, REPORT_VERY_SHORT_MAX_WORDS, SQUEEZE_STATES } from "./types";

import type { TradePlan, TradeSide } from "./types";

function activeSignalLabels(series: AnalyzedSeries): string[] {
  return series.signals.filter((s) => s.active).map((s) => s.label);
}

function lastFiniteNumber(values: Array<number | null> | undefined, index: number): number | null {
  const v = values?.[index];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function computeMoveAtr1d(series1d: AnalyzedSeries): {
  atr14: number | null;
  move1d: number | null;
  move1dAtr14: number | null;
  absMove1dAtr14: number | null;
} {
  const idx1d = series1d.bars.length - 1;
  const atr14 = Array.isArray(series1d.indicators.atr14) ? lastFiniteNumber(series1d.indicators.atr14, idx1d) : null;

  const last = series1d.bars.at(-1);
  const prev = series1d.bars.at(-2);
  const move1d = last && prev && Number.isFinite(last.c) && Number.isFinite(prev.c) ? last.c - prev.c : null;

  const move1dAtr14 = atr14 !== null && move1d !== null && atr14 !== 0 ? move1d / atr14 : null;
  const absMove1dAtr14 = move1dAtr14 !== null ? Math.abs(move1dAtr14) : null;

  return { atr14, move1d, move1dAtr14, absMove1dAtr14 };
}

function computeRocPct(bars: MarketBar[], lookback: number): number | null {
  const smooth = 3;
  if (lookback <= 0) {
    return null;
  }

  const idx = bars.length - 1;
  const prevIdx = idx - lookback;
  const recentStart = idx - (smooth - 1);
  const prevStart = prevIdx - (smooth - 1);
  if (prevStart < 0 || recentStart < 0) {
    return null;
  }

  const recentCloses = bars.slice(recentStart, idx + 1).map((b) => b.c).filter((v) => Number.isFinite(v));
  const prevCloses = bars.slice(prevStart, prevIdx + 1).map((b) => b.c).filter((v) => Number.isFinite(v));
  if (recentCloses.length < smooth || prevCloses.length < smooth) {
    return null;
  }

  const avgRecent = recentCloses.reduce((sum, v) => sum + v, 0) / recentCloses.length;
  const avgPrev = prevCloses.reduce((sum, v) => sum + v, 0) / prevCloses.length;
  if (!(Number.isFinite(avgRecent) && Number.isFinite(avgPrev) && avgPrev !== 0)) {
    return null;
  }

  const roc = (avgRecent - avgPrev) / avgPrev;
  return Number.isFinite(roc) ? roc : null;
}

function sign(value: number): -1 | 0 | 1 {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}

const PICK_POLICY = {
  minTradeAbsMoveAtr: 1,
  momentumLookback: {
    "15m": 20,
    "1h": 20,
    "1d": 20
  } as const,
  strongDailyRoc: 0.03,
  levelLookback1d: 90,
  nearLevelMaxAtr: 0.35,
  levelMinHitsForSetup: 2,
  pivotClustering: {
    atrFraction: 0.25,
    priceFractionFallback: 0.004,
    maxClosestClusters: 6,
    maxDistanceAtr: 4,
    maxDistancePctFallback: 0.12
  },
  participation: {
    minRangeAtr: 1,
    minVolMultiple20: 1.3
  }
} as const;

const PICK_SCORE = {
  trendStrengthScale: 900,
  signalCountBonus: 2,
  rocAbsMax: {
    "15m": 35,
    "1h": 45,
    "1d": 60
  } as const,
  rocAbsScale: {
    "15m": 8500,
    "1h": 4500,
    "1d": 1200
  } as const,
  momentumAlignedBonus: 25,
  breakoutBonus: {
    20: 25,
    55: 40,
    252: 55
  } as const,
  participationBonus: 25,
  participationDirectionBonus: 10,
  nearLevelBonus: 20,
  nearLevelHitsBonusMax: 12,
  nearLevelHitsBonusPerHit: 3,
  moveAtrBonusMax: 42,
  moveAtrScale: 6,
  moveAtrBigMoveThreshold: 2,
  moveAtrBigMoveBonus: 12,
  rsiDeviationBonusMax: 8,
  rsiDeviationScaleDiv: 6
} as const;

const PICK_NON_SELECTABLE_SYMBOL_PREFIXES = ["^"] as const;

// Single source of truth for pick/watchlist symbol eligibility.
function isNonSelectableSymbol(symbol: string): boolean {
  // Market context symbols (e.g. indices like ^VIX) are still allowed elsewhere (regime readout, most active).
  return PICK_NON_SELECTABLE_SYMBOL_PREFIXES.some((prefix) => symbol.startsWith(prefix));
}

const SECTOR_PROXY_SYMBOLS = [
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "XLF",
  "VFH",
  "XLV",
  "VHT",
  "XLE",
  "XLY",
  "XLC",
  "XLI",
  "XLB",
  "XLU",
  "VGT",
  "VNQ"
] as const;

type SectorProxyContext = {
  symbol: (typeof SECTOR_PROXY_SYMBOLS)[number];
  correlation: number;
  move1dPct: number | null;
  move20dPct: number | null;
};

const SECTOR_PROXY_WINDOW_BARS = 120;
const SECTOR_PROXY_MIN_RETURNS = 60;
const SECTOR_PROXY_MIN_CORRELATION = 0.35;

function computeReturnSeriesForCorrelation(series: AnalyzedSeries): number[] {
  const closes = series.bars
    .slice(-SECTOR_PROXY_WINDOW_BARS)
    .map((b) => b.c)
    .filter((v): v is number => Number.isFinite(v));

  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!(prev !== 0)) {
      continue;
    }
    const ret = (cur - prev) / prev;
    if (Number.isFinite(ret)) {
      out.push(ret);
    }
  }

  return out;
}

function computeMovePct1d(series1d: AnalyzedSeries, lookback: number): number | null {
  if (series1d.interval !== "1d") {
    return null;
  }

  if (lookback <= 0) {
    return null;
  }

  const bars = series1d.bars;
  const idx = bars.length - 1;
  // `lookback = 1` compares the latest close vs the prior bar (i.e. a 1-session change).
  const prevIdx = idx - lookback;
  if (prevIdx < 0) {
    return null;
  }

  const last = bars[idx];
  const prev = bars[prevIdx];
  if (!last || !prev) {
    return null;
  }
  if (!(Number.isFinite(last.c) && Number.isFinite(prev.c) && prev.c !== 0)) {
    return null;
  }

  const pct = (last.c - prev.c) / prev.c;
  return Number.isFinite(pct) ? pct : null;
}

function computePearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 12) {
    return null;
  }

  const sliceA = a.slice(-n);
  const sliceB = b.slice(-n);

  const meanA = sliceA.reduce((sum, v) => sum + v, 0) / n;
  const meanB = sliceB.reduce((sum, v) => sum + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = sliceA[i] - meanA;
    const db = sliceB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (!(varA > 0 && varB > 0)) {
    return null;
  }

  const corr = cov / Math.sqrt(varA * varB);
  return Number.isFinite(corr) ? corr : null;
}

function findSectorProxy(
  symbol: string,
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>
): SectorProxyContext | null {
  const series = analyzedBySymbol[symbol]?.["1d"];
  if (!series) {
    return null;
  }

  const symbolReturns = computeReturnSeriesForCorrelation(series);
  if (symbolReturns.length < SECTOR_PROXY_MIN_RETURNS) {
    return null;
  }

  let best: SectorProxyContext | null = null;

  for (const proxySymbol of SECTOR_PROXY_SYMBOLS) {
    if (proxySymbol === symbol) {
      continue;
    }

    const proxySeries = analyzedBySymbol[proxySymbol]?.["1d"];
    if (!proxySeries) {
      continue;
    }

    const proxyReturns = computeReturnSeriesForCorrelation(proxySeries);

    const corr = computePearsonCorrelation(symbolReturns, proxyReturns);
    if (corr === null) {
      continue;
    }

    if (!best || corr > best.correlation) {
      best = {
        symbol: proxySymbol,
        correlation: corr,
        move1dPct: computeMovePct1d(proxySeries, 1),
        move20dPct: computeMovePct1d(proxySeries, 20)
      };
    }
  }

  if (!best || best.correlation < SECTOR_PROXY_MIN_CORRELATION) {
    return null;
  }

  return best;
}

type AnalystSignal = {
  lines: string[];
  tone: "bullish" | "bearish" | "mixed" | null;
};

function inferAnalystSignalTone(title: string): AnalystSignal["tone"] {
  const t = title.toLowerCase();
  const bearish =
    /(downgrad(e|es|ed)|cut[s]?\s+price\s+target|lowers\s+price\s+target|cut[s]?\s+to\s+(sell|underperform|underweight|neutral|hold)|initiates?\s+at\s+(sell|underperform|underweight))/i;
  const bullish =
    /(upgrad(e|es|ed)|raises\s+price\s+target|initiates?\s+at\s+(buy|outperform|overweight)|reiterates?\s+(buy|outperform|overweight)|to\s+(buy|outperform|overweight))/i;

  const isBear = bearish.test(t);
  const isBull = bullish.test(t);
  if (isBear && isBull) {
    return "mixed";
  }
  if (isBear) {
    return "bearish";
  }
  if (isBull) {
    return "bullish";
  }
  return null;
}

function extractAnalystSignals(snapshot: MarketNewsSnapshot | undefined): AnalystSignal {
  if (!snapshot || !Array.isArray(snapshot.articles)) {
    return { lines: [], tone: null };
  }

  const tagged = snapshot.articles
    .map((a) => {
      const tone = inferAnalystSignalTone(a.title);
      return { title: a.title, publisher: a.publisher, tone };
    })
    .filter((a) => a.tone !== null);

  const lines = tagged.slice(0, 2).map((a) => `${a.title}${a.publisher ? ` (${a.publisher})` : ""}`);

  const tones = tagged.map((t) => t.tone).filter((t): t is Exclude<AnalystSignal["tone"], null> => t !== null);
  const hasBull = tones.includes("bullish");
  const hasBear = tones.includes("bearish");
  const tone: AnalystSignal["tone"] = hasBull && hasBear ? "mixed" : hasBull ? "bullish" : hasBear ? "bearish" : null;

  return { lines, tone };
}

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text;
  }
  return `${words.slice(0, maxWords).join(" ")} …`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatPriceCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) {
    return value.toFixed(2);
  }
  if (abs >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(5);
}

type PickNarrativeArgs = {
  kind: "pick" | "watchlist";
  symbol: string;
  side: TradeSide;
  trade: TradePlan;
  breakout: BreakoutHit;
  momentum: {
    roc15: number | null;
    roc1h: number | null;
    roc1d: number | null;
    aligned: boolean;
  };
  atr1d: number | null;
  support: { level: number; distAtr: number | null; hits: number } | null;
  resistance: { level: number; distAtr: number | null; hits: number } | null;
  signals1d: string[];
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>;
  news: MarketNewsSnapshot | undefined;
};

function buildPickSetupText(args: PickNarrativeArgs): string {
  const sideLabel = args.side === "buy" ? "bullish" : "bearish";
  const setupParts: string[] = [];

  if (args.breakout) {
    const aboveBelow = args.breakout.direction === "up" ? "above" : "below";
    setupParts.push(
      `With a recent close ${aboveBelow} the prior ${args.breakout.window}d level (${formatPriceCompact(args.breakout.level)}), ${args.symbol} has a ${sideLabel} setup.`
    );
  } else {
    setupParts.push(`${args.symbol} is setting up ${sideLabel} with multi-timeframe momentum as the primary driver.`);
  }

  const momentumParts: string[] = [];
  if (typeof args.momentum.roc15 === "number") {
    momentumParts.push(`15m ${formatPct(args.momentum.roc15)}`);
  }
  if (typeof args.momentum.roc1h === "number") {
    momentumParts.push(`1h ${formatPct(args.momentum.roc1h)}`);
  }
  if (typeof args.momentum.roc1d === "number") {
    momentumParts.push(`1d ${formatPct(args.momentum.roc1d)}`);
  }
  if (momentumParts.length > 0) {
    setupParts.push(`Momentum: ${momentumParts.join(", ")}${args.momentum.aligned ? " (aligned)" : ""}.`);
  }

  if (args.resistance && args.support) {
    setupParts.push(
      `Key pivots: support ${formatPriceCompact(args.support.level)}, resistance ${formatPriceCompact(args.resistance.level)}.`
    );
  } else if (args.resistance) {
    setupParts.push(`Key pivot resistance: ${formatPriceCompact(args.resistance.level)}.`);
  } else if (args.support) {
    setupParts.push(`Key pivot support: ${formatPriceCompact(args.support.level)}.`);
  }

  return setupParts.join(" ");
}

function buildPickRiskText(args: PickNarrativeArgs): string {
  const riskParts: string[] = [];
  const entry = formatPriceCompact(args.trade.entry);
  const stop = formatPriceCompact(args.trade.stop);
  const [target1, target2] = args.trade.targets;
  const targets = [target1, target2]
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t))
    .map((t) => formatPriceCompact(t));
  const MAX_ATR_MULTIPLE = 6;
  function computeAtrMultiple(target: number | undefined): { multiple: number | null; tooFar: boolean } {
    if (!(typeof args.atr1d === "number" && args.atr1d > 0 && typeof target === "number")) {
      return { multiple: null, tooFar: false };
    }
    const multiple = Math.abs(target - args.trade.entry) / args.atr1d;
    if (!Number.isFinite(multiple)) {
      return { multiple: null, tooFar: false };
    }
    if (multiple > MAX_ATR_MULTIPLE) {
      return { multiple: null, tooFar: true };
    }
    return { multiple, tooFar: false };
  }

  const t1 = computeAtrMultiple(target1);
  const t2 = computeAtrMultiple(target2);
  const t1Atr = t1.multiple;
  const t2Atr = t2.multiple;
  const hasFarTarget = t1.tooFar || t2.tooFar;
  const farLabel = hasFarTarget ? `, >${MAX_ATR_MULTIPLE} ATR` : "";
  const atrLabel =
    t1Atr !== null && t2Atr !== null
      ? ` (~${t1Atr.toFixed(1)}–${t2Atr.toFixed(1)} ATR)`
      : t1Atr !== null
        ? ` (~${t1Atr.toFixed(1)} ATR${farLabel})`
      : typeof args.atr1d === "number" && args.atr1d > 0
        ? ` (ATR14 ${formatPriceCompact(args.atr1d)}${farLabel})`
        : "";

  const targetsLabel = targets.length > 0 ? ` targeting ${targets.join(" / ")}` : "";
  const planPrefix = args.kind === "watchlist" ? "If triggered:" : "Plan:";
  riskParts.push(
    `${planPrefix} ${args.side === "buy" ? "long" : "short"} entry ${entry} (stop ${stop})${targetsLabel}${atrLabel}.`
  );

  const rsiOversold = args.signals1d.some((s) => /\brsi\s+oversold\b/i.test(s));
  const rsiOverbought = args.signals1d.some((s) => /\brsi\s+overbought\b/i.test(s));
  if (rsiOversold && args.side === "sell") {
    riskParts.push("RSI is oversold, so expect bounces; stay tight on risk.");
  } else if (rsiOverbought && args.side === "buy") {
    riskParts.push("RSI is overbought, so chase risk is elevated; keep size disciplined.");
  }

  return riskParts.join(" ");
}

function buildPickContextText(args: PickNarrativeArgs): string {
  const dirLabel = args.side === "buy" ? "upside" : "downside";
  const contextParts: string[] = [];
  const sectorProxy = findSectorProxy(args.symbol, args.analyzedBySymbol);
  if (sectorProxy) {
    const proxyMoveLabel =
      typeof sectorProxy.move1dPct === "number" ? `${sectorProxy.symbol} ${formatPct(sectorProxy.move1dPct)} today` : null;
    const proxy20dLabel =
      typeof sectorProxy.move20dPct === "number" ? `${formatPct(sectorProxy.move20dPct)} over ~20d` : null;
    const joiner = proxyMoveLabel && proxy20dLabel ? ` (${proxy20dLabel})` : proxy20dLabel ? ` (${proxy20dLabel})` : "";
    if (proxyMoveLabel) {
      contextParts.push(`Sector check: closest proxy ${proxyMoveLabel}${joiner} (corr ${sectorProxy.correlation.toFixed(2)}).`);
    } else {
      contextParts.push(`Sector check: closest proxy ${sectorProxy.symbol} (corr ${sectorProxy.correlation.toFixed(2)}).`);
    }
  }

  const analyst = extractAnalystSignals(args.news);
  if (analyst.lines.length > 0) {
    const mood = analyst.tone;
    const reinforcement =
      mood === null
        ? null
        : mood === "mixed"
          ? "mixed"
          : (mood === "bearish" && args.side === "sell") || (mood === "bullish" && args.side === "buy")
            ? "reinforces"
            : "contrasts with";

    const prefix =
      reinforcement === "reinforces"
        ? `Analyst flow reinforces the ${dirLabel} call:`
        : reinforcement === "contrasts with"
          ? `Analyst flow contrasts with the ${dirLabel} call (more contrarian):`
          : "Analyst flow:";

    if (reinforcement === "contrasts with") {
      contextParts.push(
        `${prefix} ${analyst.lines.join(" | ")}. We are leaning on the technical setup here; treat this as a contrarian idea with tighter risk.`
      );
    } else {
      contextParts.push(`${prefix} ${analyst.lines.join(" | ")}.`);
    }
  }

  return contextParts.join(" ");
}

const PICK_NARRATIVE_MAX_SETUP_WORDS = 45;
const PICK_NARRATIVE_MAX_RISK_WORDS = 35;
const PICK_NARRATIVE_MAX_CONTEXT_WORDS = 45;

function buildPickNarrative(args: PickNarrativeArgs): string {
  const setup = capWords(buildPickSetupText(args).trim(), PICK_NARRATIVE_MAX_SETUP_WORDS);
  const risk = capWords(buildPickRiskText(args).trim(), PICK_NARRATIVE_MAX_RISK_WORDS);
  const context = capWords(buildPickContextText(args).trim(), PICK_NARRATIVE_MAX_CONTEXT_WORDS);

  return [setup, risk, context].filter(Boolean).join(" ");
}

const REGIME_POLICY = {
  riskOn: {
    breadthPctMin: 0.55,
    vixChangePctMax: -0.02
  },
  riskOff: {
    breadthPctMax: 0.45,
    vixChangePctMin: 0.02
  }
} as const;

// Narrative-only bias: intentionally conservative to avoid overconfident stance on small watchlists.
const WATCHLIST_NARRATIVE_BIAS_MIN_TOTAL = 4;
const WATCHLIST_NARRATIVE_BIAS_MIN_MARGIN = 2;

function getNarrativeWatchlistBias(picks: ReportPick[]): "bullish" | "bearish" | "mixed" {
  let buyCount = 0;
  let sellCount = 0;
  for (const p of picks) {
    // Bias is based on directional trade setups only.
    if (p.trade.side === "buy") {
      buyCount += 1;
    } else if (p.trade.side === "sell") {
      sellCount += 1;
    }
  }

  const total = buyCount + sellCount;
  const margin = Math.abs(buyCount - sellCount);

  // Avoid overconfident narrative on small watchlists.
  if (total >= WATCHLIST_NARRATIVE_BIAS_MIN_TOTAL && margin >= WATCHLIST_NARRATIVE_BIAS_MIN_MARGIN) {
    return buyCount > sellCount ? "bullish" : "bearish";
  }

  return "mixed";
}

type BreakoutHit =
  | {
      direction: "up" | "down";
      window: 20 | 55 | 252;
      level: number;
    }
  | null;

function previousHighLow(bars: MarketBar[], lookback: number): { high: number; low: number } | null {
  const end = bars.length - 1;
  const start = end - lookback;
  if (start < 0 || end <= 0) {
    return null;
  }

  const window = bars.slice(start, end);
  if (window.length === 0) {
    return null;
  }

  const highs = window.map((b) => b.h).filter((v) => Number.isFinite(v));
  const lows = window.map((b) => b.l).filter((v) => Number.isFinite(v));
  if (highs.length === 0 || lows.length === 0) {
    return null;
  }

  return {
    high: Math.max(...highs),
    low: Math.min(...lows)
  };
}

function detectDailyBreakout(series1d: AnalyzedSeries): BreakoutHit {
  const last = series1d.bars.at(-1);
  if (!last || !Number.isFinite(last.c)) {
    return null;
  }

  const close = last.c;
  const windows = [252, 55, 20] as const;
  for (const w of windows) {
    const hl = previousHighLow(series1d.bars, w);
    if (!hl) {
      continue;
    }

    if (close > hl.high) {
      return { direction: "up", window: w, level: hl.high };
    }
    if (close < hl.low) {
      return { direction: "down", window: w, level: hl.low };
    }
  }

  return null;
}

type PivotLevel = { level: number; hits: number };

function computePivotLevels(
  bars: MarketBar[],
  maxBars: number,
  atr1d: number | null
): { support: PivotLevel | null; resistance: PivotLevel | null } {
  const last = bars.at(-1);
  if (!last || !Number.isFinite(last.c)) {
    return { support: null, resistance: null };
  }

  const close = last.c;
  const windowBars = bars.slice(-Math.max(maxBars, 10));
  const leftRight = 2;

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  for (let i = leftRight; i < windowBars.length - leftRight; i += 1) {
    const center = windowBars[i];
    if (!center) {
      continue;
    }

    const ch = center.h;
    const cl = center.l;
    if (!(Number.isFinite(ch) && Number.isFinite(cl))) {
      continue;
    }

    let isPivotHigh = true;
    let isPivotLow = true;
    for (let j = 1; j <= leftRight; j += 1) {
      const left = windowBars[i - j];
      const right = windowBars[i + j];
      if (!left || !right) {
        isPivotHigh = false;
        isPivotLow = false;
        break;
      }

      if (!(Number.isFinite(left.h) && Number.isFinite(right.h) && Number.isFinite(left.l) && Number.isFinite(right.l))) {
        isPivotHigh = false;
        isPivotLow = false;
        break;
      }

      if (ch <= left.h || ch <= right.h) {
        isPivotHigh = false;
      }
      if (cl >= left.l || cl >= right.l) {
        isPivotLow = false;
      }
    }

    if (isPivotHigh) {
      pivotHighs.push(ch);
    }
    if (isPivotLow) {
      pivotLows.push(cl);
    }
  }

  const toleranceAbs =
    typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0
      ? atr1d * PICK_POLICY.pivotClustering.atrFraction
      : close * PICK_POLICY.pivotClustering.priceFractionFallback;

  function clusterLevels(levels: number[]): PivotLevel[] {
    const sorted = levels.slice().sort((a, b) => a - b);
    if (sorted.length === 0) {
      return [];
    }

    const out: PivotLevel[] = [];
    let cluster: number[] = [sorted[0]!];

    function flush(): void {
      const avg = cluster.reduce((sum, v) => sum + v, 0) / cluster.length;
      out.push({ level: avg, hits: cluster.length });
      cluster = [];
    }

    for (let i = 1; i < sorted.length; i += 1) {
      const v = sorted[i]!;
      const lastV = cluster.at(-1);
      if (typeof lastV !== "number") {
        cluster = [v];
        continue;
      }

      if (Math.abs(v - lastV) <= toleranceAbs) {
        cluster.push(v);
      } else {
        flush();
        cluster = [v];
      }
    }

    if (cluster.length > 0) {
      flush();
    }

    return out;
  }

  const supportClusters = clusterLevels(pivotLows).filter((p) => p.level < close);
  const resistanceClusters = clusterLevels(pivotHighs).filter((p) => p.level > close);

  function selectBestCluster(clusters: PivotLevel[], direction: "support" | "resistance"): PivotLevel | null {
    if (clusters.length === 0) {
      return null;
    }

    function distanceToClose(level: number): number {
      return direction === "support" ? close - level : level - close;
    }

    const filtered = clusters.filter((c) => {
      const dist = distanceToClose(c.level);
      if (!(Number.isFinite(dist) && dist >= 0)) {
        return false;
      }

      if (typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0) {
        return dist / atr1d <= PICK_POLICY.pivotClustering.maxDistanceAtr;
      }
      return close !== 0 ? dist / close <= PICK_POLICY.pivotClustering.maxDistancePctFallback : false;
    });

    if (filtered.length === 0) {
      return null;
    }

    const sortedByDistance = filtered
      .slice()
      .sort((a, b) => distanceToClose(a.level) - distanceToClose(b.level));
    const closest = sortedByDistance.slice(0, PICK_POLICY.pivotClustering.maxClosestClusters);
    const maxHits = Math.max(...closest.map((c) => c.hits));

    const bestByHits = closest.filter((c) => c.hits === maxHits);
    return bestByHits.sort((a, b) => distanceToClose(a.level) - distanceToClose(b.level))[0] ?? null;
  }

  const support = selectBestCluster(supportClusters, "support");
  const resistance = selectBestCluster(resistanceClusters, "resistance");

  return { support, resistance };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function computeParticipation1d(series1d: AnalyzedSeries, atr1d: number | null): {
  rangeAtr: number | null;
  volumeMultiple20: number | null;
  direction: "up" | "down" | null;
} {
  const last = series1d.bars.at(-1);
  const prev = series1d.bars.at(-2);
  if (!last || !prev) {
    return { rangeAtr: null, volumeMultiple20: null, direction: null };
  }

  const range = Number.isFinite(last.h) && Number.isFinite(last.l) ? last.h - last.l : null;
  const rangeAtr =
    range !== null && typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0 ? range / atr1d : null;

  const prevBars = series1d.bars.slice(-21, -1);
  const volAvg = average(prevBars.map((b) => b.v).filter((v) => Number.isFinite(v)));
  const volumeMultiple20 =
    volAvg !== null && Number.isFinite(last.v) && volAvg > 0 ? last.v / volAvg : null;

  const direction =
    Number.isFinite(last.c) && Number.isFinite(prev.c)
      ? last.c > prev.c
        ? "up"
        : last.c < prev.c
          ? "down"
          : null
      : null;

  return { rangeAtr, volumeMultiple20, direction };
}

type ParticipationMetrics = ReturnType<typeof computeParticipation1d>;

function isParticipationBacked(
  metrics: ParticipationMetrics,
  policy: typeof PICK_POLICY.participation = PICK_POLICY.participation
): boolean {
  return (
    typeof metrics.rangeAtr === "number" &&
    metrics.rangeAtr >= policy.minRangeAtr &&
    typeof metrics.volumeMultiple20 === "number" &&
    metrics.volumeMultiple20 >= policy.minVolMultiple20
  );
}

function inferTradeSideFromTrend(series: AnalyzedSeries): TradeSide | null {
  const idx = series.bars.length - 1;
  if (idx < 0) {
    return null;
  }

  const close = series.bars[idx]?.c;
  const ema20 = Array.isArray(series.indicators.ema20)
    ? lastFiniteNumber(series.indicators.ema20, idx)
    : null;
  const sma20 = Array.isArray(series.indicators.sma20)
    ? lastFiniteNumber(series.indicators.sma20, idx)
    : null;

  if (typeof close !== "number" || ema20 === null || sma20 === null) {
    return null;
  }

  if (close > ema20 && ema20 > sma20) {
    return "buy";
  }

  if (close < ema20 && ema20 < sma20) {
    return "sell";
  }

  return null;
}

function clampToValidStop(entry: number, side: TradeSide, stop: number): number {
  const fallbackPct = 0.015;
  if (side === "buy") {
    if (!(stop < entry)) {
      return entry * (1 - fallbackPct);
    }

    const riskPct = (entry - stop) / entry;
    if (riskPct < 0.002) {
      return entry * (1 - fallbackPct);
    }
    return stop;
  }

  if (!(stop > entry)) {
    return entry * (1 + fallbackPct);
  }

  const riskPct = (stop - entry) / entry;
  if (riskPct < 0.002) {
    return entry * (1 + fallbackPct);
  }
  return stop;
}

function buildTradePlan(series15m: AnalyzedSeries, side: TradeSide, atr1d: number | null): TradePlan {
  const last = series15m.bars.at(-1);
  if (!last) {
    throw new Error(`Missing bars for ${series15m.symbol} 15m`);
  }

  const entry = last.c;
  if (!Number.isFinite(entry)) {
    throw new Error(`Invalid entry price for ${series15m.symbol} 15m`);
  }

  const recent = series15m.bars.slice(-20);
  if (recent.length === 0) {
    throw new Error(`Insufficient bars for ${series15m.symbol} 15m`);
  }

  const lows = recent.map((b) => b.l).filter((v) => Number.isFinite(v));
  const highs = recent.map((b) => b.h).filter((v) => Number.isFinite(v));
  if (lows.length === 0 || highs.length === 0) {
    throw new Error(`Invalid highs/lows for ${series15m.symbol} 15m`);
  }

  const buffer = entry * 0.001;

  let stop: number;
  if (side === "buy") {
    stop = Math.min(...lows) - buffer;
  } else {
    stop = Math.max(...highs) + buffer;
  }

  stop = clampToValidStop(entry, side, stop);
  const risk = Math.abs(entry - stop);
  const dir = side === "buy" ? 1 : -1;

  const atrMove1 = typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0 ? atr1d * 2 : null;
  const atrMove2 = typeof atr1d === "number" && Number.isFinite(atr1d) && atr1d > 0 ? atr1d * 3 : null;
  const move1 = Math.max(risk * 2, atrMove1 ?? 0);
  const move2 = Math.max(risk * 3, atrMove2 ?? 0);
  const targets = [entry + dir * move1, entry + dir * move2];

  return { side, entry, stop, targets };
}

function safeDollarVolume(bar: { c: number; v: number } | undefined): number | null {
  if (!bar) {
    return null;
  }

  if (!(Number.isFinite(bar.c) && Number.isFinite(bar.v))) {
    return null;
  }

  const dv = bar.c * bar.v;
  return Number.isFinite(dv) ? dv : null;
}

function buildMostActive(args: {
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>;
}): MarketReport["mostActive"] {
  const entries: MostActiveEntry[] = [];

  for (const symbol of Object.keys(args.analyzedBySymbol)) {
    const series1d = args.analyzedBySymbol[symbol]?.["1d"];
    if (!series1d) {
      continue;
    }

    const last = series1d.bars.at(-1);
    const prev = series1d.bars.at(-2);
    if (!last || !Number.isFinite(last.c)) {
      continue;
    }

    const dollarVolume1d = safeDollarVolume(last);
    if (dollarVolume1d === null) {
      continue;
    }

    const weekBars = series1d.bars.slice(-5);
    const dvWeek = weekBars.map((b) => safeDollarVolume(b)).filter((v): v is number => typeof v === "number");
    if (dvWeek.length < 3) {
      continue;
    }
    const dollarVolume5d = dvWeek.reduce((sum, v) => sum + v, 0);

    const idx = series1d.bars.length - 1;
    const atr14 = Array.isArray(series1d.indicators.atr14)
      ? lastFiniteNumber(series1d.indicators.atr14, idx)
      : null;

    const change1d = prev && Number.isFinite(prev.c) ? last.c - prev.c : null;
    const change1dPct =
      change1d !== null && prev && Number.isFinite(prev.c) && prev.c !== 0 ? change1d / prev.c : null;
    const change1dAtr14 = atr14 !== null && change1d !== null && atr14 !== 0 ? change1d / atr14 : null;

    entries.push({
      symbol,
      dollarVolume1d,
      dollarVolume5d,
      close: last.c,
      change1d,
      change1dPct,
      atr14,
      change1dAtr14,
      trendBias1d: inferTradeSideFromTrend(series1d),
      signals1d: activeSignalLabels(series1d)
    });
  }

  if (entries.length === 0) {
    return undefined;
  }

  const byDollarVolume1d = entries
    .slice()
    .sort((a, b) => b.dollarVolume1d - a.dollarVolume1d || a.symbol.localeCompare(b.symbol))
    .slice(0, 12);

  const byDollarVolume5d = entries
    .slice()
    .sort((a, b) => b.dollarVolume5d - a.dollarVolume5d || a.symbol.localeCompare(b.symbol))
    .slice(0, 12);

  return { byDollarVolume1d, byDollarVolume5d };
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toReportSeries(analyzed: AnalyzedSeries, maxPoints: number): ReportIntervalSeries {
  const bars = analyzed.bars;
  const startIndex = Math.max(0, bars.length - maxPoints);
  const slicedBars = bars.slice(startIndex);
  const sliceLength = slicedBars.length;

  const warnPrefix = `[report] ${analyzed.symbol}/${analyzed.interval}`;

  function warn(message: string): void {
    console.warn(`${warnPrefix} ${message}`);
  }

  function sliceNullableNumberSeries(value: unknown, context: string): Array<number | null> {
    const fallback = new Array(sliceLength).fill(null);

    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return fallback;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return fallback;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v !== "number") {
        invalidCount += 1;
        return null;
      }

      return toNullableNumber(v);
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-number items to null`);
    }

    return out;
  }

  function sliceStrictNullableNumberSeries(
    value: unknown,
    context: string
  ): Array<number | null> | undefined {
    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return undefined;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return undefined;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v !== "number") {
        invalidCount += 1;
        return null;
      }

      return toNullableNumber(v);
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-number items to null`);
    }

    return out;
  }

  function sliceStrictNullableBoolSeries(
    value: unknown,
    context: string
  ): Array<boolean | null> | undefined {
    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return undefined;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return undefined;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v !== "boolean") {
        invalidCount += 1;
        return null;
      }

      return toNullableBoolean(v);
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-boolean items to null`);
    }

    return out;
  }

  function sliceStrictNullableSqueezeStateSeries(
    value: unknown,
    context: string
  ): Array<SqueezeState | null> | undefined {
    if (!Array.isArray(value)) {
      warn(`Invalid ${context} series: expected array`);
      return undefined;
    }
    if (value.length !== bars.length) {
      warn(`Invalid ${context} series length: expected ${bars.length}, got ${value.length}`);
      return undefined;
    }

    let invalidCount = 0;
    const out = slicedBars.map((_, idx) => {
      const i = startIndex + idx;
      const v = value[i];
      if (v === null || v === undefined) {
        return null;
      }

      if (typeof v === "string" && (SQUEEZE_STATES as readonly string[]).includes(v)) {
        return v as SqueezeState;
      }

      invalidCount += 1;
      return null;
    });

    if (invalidCount > 0) {
      warn(`Invalid ${context} series values: coerced ${invalidCount} non-state items to null`);
    }

    return out;
  }

  type ChannelSeries = { middle: Array<number | null>; upper: Array<number | null>; lower: Array<number | null> };

  function sliceChannelSeries(value: unknown, context: string): ChannelSeries | undefined {
    if (!isRecord(value)) {
      warn(`Invalid ${context} series: expected object`);
      return undefined;
    }

    const middle = sliceStrictNullableNumberSeries(value.middle, `${context}.middle`);
    const upper = sliceStrictNullableNumberSeries(value.upper, `${context}.upper`);
    const lower = sliceStrictNullableNumberSeries(value.lower, `${context}.lower`);
    if (!middle || !upper || !lower) {
      return undefined;
    }

    return {
      middle,
      upper,
      lower
    };
  }

  function sliceTtmSqueezeSeries(value: unknown, context: string): TtmSqueezeSeries | undefined {
    if (!isRecord(value)) {
      warn(`Invalid ${context} series: expected object`);
      return undefined;
    }

    const bollinger = sliceChannelSeries(value.bollinger, `${context}.bollinger`);
    const keltner = sliceChannelSeries(value.keltner, `${context}.keltner`);
    if (!bollinger || !keltner) {
      return undefined;
    }

    const squeezeOn = sliceStrictNullableBoolSeries(value.squeezeOn, `${context}.squeezeOn`);
    const squeezeOff = sliceStrictNullableBoolSeries(value.squeezeOff, `${context}.squeezeOff`);
    const momentum = sliceStrictNullableNumberSeries(value.momentum, `${context}.momentum`);
    if (!squeezeOn || !squeezeOff || !momentum) {
      return undefined;
    }

    const derivedSqueezeState = squeezeOn.map((on, idx) => {
      const off = squeezeOff[idx];
      if (on === null || off === null) {
        return null;
      }
      return on ? "on" : off ? "off" : "neutral";
    });

    const squeezeState =
      value.squeezeState === undefined
        ? derivedSqueezeState
        : sliceStrictNullableSqueezeStateSeries(value.squeezeState, `${context}.squeezeState`) ?? derivedSqueezeState;

    const hasMomentum = momentum.some((v) => v !== null);
    const hasSqueezeFlag = squeezeOn.some((v) => v !== null) || squeezeOff.some((v) => v !== null);
    if (!hasMomentum && !hasSqueezeFlag) {
      return undefined;
    }

    return {
      bollinger,
      keltner,
      squeezeOn,
      squeezeOff,
      squeezeState,
      momentum
    };
  }

  const sma =
    analyzed.indicators.sma20 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.sma20, "sma20");
  const ema =
    analyzed.indicators.ema20 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.ema20, "ema20");
  const rsi =
    analyzed.indicators.rsi14 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.rsi14, "rsi14");
  const atr =
    analyzed.indicators.atr14 === undefined
      ? new Array(sliceLength).fill(null)
      : sliceNullableNumberSeries(analyzed.indicators.atr14, "atr14");

  const bollingerOut =
    analyzed.indicators.bollinger20 === undefined
      ? undefined
      : (sliceChannelSeries(analyzed.indicators.bollinger20, "bollinger20") as
          | BollingerBandsSeries
          | undefined);
  const keltnerOut =
    analyzed.indicators.keltner20 === undefined
      ? undefined
      : (sliceChannelSeries(analyzed.indicators.keltner20, "keltner20") as
          | KeltnerChannelsSeries
          | undefined);
  const ttmOut =
    analyzed.indicators.ttmSqueeze20 === undefined
      ? undefined
      : sliceTtmSqueezeSeries(analyzed.indicators.ttmSqueeze20, "ttmSqueeze20");

  const t = slicedBars.map((b) => Math.floor(new Date(b.t).getTime() / 1000));
  const open = slicedBars.map((b) => b.o);
  const close = slicedBars.map((b) => b.c);
  const high = slicedBars.map((b) => b.h);
  const low = slicedBars.map((b) => b.l);
  const volume = slicedBars.map((b) => (Number.isFinite(b.v) && b.v >= 0 ? b.v : null));

  return {
    symbol: analyzed.symbol,
    interval: analyzed.interval,
    t,
    open,
    close,
    high,
    low,
    volume,
    sma20: sma,
    ema20: ema,
    rsi14: rsi,
    atr14: atr,
    bollinger20: bollingerOut,
    keltner20: keltnerOut,
    ttmSqueeze20: ttmOut,
    signals: analyzed.signals
  };
}

function buildPicks(args: {
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>;
}): { picks: ReportPick[]; watchlist: ReportPick[] } {
  // Policy:
  // - Technical trades: should be driven by an explicit setup (momentum alignment, breakouts, or levels) and
  //   ideally have a >= 1 ATR daily move when ATR is available.
  // - Watchlist: trend-following setups, or explicit setups that are still sub-ATR on the day.
  const minTradeAbsMoveAtr = PICK_POLICY.minTradeAbsMoveAtr;
  const momentumLookback = PICK_POLICY.momentumLookback;
  const levelLookback1d = PICK_POLICY.levelLookback1d;
  const nearLevelMaxAtr = PICK_POLICY.nearLevelMaxAtr;

  type Candidate = ReportPick & {
    absMove1dAtr14: number | null;
    breakout: BreakoutHit;
    hasParticipation: boolean;
    dollarVolume1d: number | null;
  };

  const candidates: Candidate[] = [];

  for (const symbol of Object.keys(args.analyzedBySymbol)) {
    if (isNonSelectableSymbol(symbol)) {
      continue;
    }

    const series15m = args.analyzedBySymbol[symbol]?.["15m"];
    const series1h = args.analyzedBySymbol[symbol]?.["1h"];
    const series1d = args.analyzedBySymbol[symbol]?.["1d"];
    if (!series15m || !series1d) {
      continue;
    }

    const dollarVolume1d = safeDollarVolume(series1d.bars.at(-1));

    const breakout = detectDailyBreakout(series1d);

    const roc15 = computeRocPct(series15m.bars, momentumLookback["15m"]);
    const roc1h = series1h ? computeRocPct(series1h.bars, momentumLookback["1h"]) : null;
    const roc1d = computeRocPct(series1d.bars, momentumLookback["1d"]);

    const rocValues = [roc15, roc1h, roc1d].filter((v): v is number => typeof v === "number");
    const rocSigns = rocValues.map(sign).filter((s): s is -1 | 1 => s !== 0);
    const momentumAligned = rocSigns.length >= 2 && rocSigns.every((s) => s === rocSigns[0]);
    const momentumSide: TradeSide | null = momentumAligned ? (rocSigns[0] === 1 ? "buy" : "sell") : null;

    const strongDailyMomentumSide: TradeSide | null =
      typeof roc1d === "number" && Math.abs(roc1d) >= PICK_POLICY.strongDailyRoc
        ? roc1d > 0
          ? "buy"
          : roc1d < 0
            ? "sell"
            : null
        : null;

    const breakoutSide: TradeSide | null = breakout ? (breakout.direction === "up" ? "buy" : "sell") : null;

    const sideTrend15 = inferTradeSideFromTrend(series15m);
    const sideTrend1h = series1h ? inferTradeSideFromTrend(series1h) : null;
    const sideTrend1d = inferTradeSideFromTrend(series1d);

    const side = breakoutSide ?? momentumSide ?? strongDailyMomentumSide ?? sideTrend1d ?? sideTrend1h ?? sideTrend15;
    if (!side) {
      continue;
    }

    const signals15 = activeSignalLabels(series15m);
    const signals1h = series1h ? activeSignalLabels(series1h) : [];
    const signals1d = activeSignalLabels(series1d);

    const moveInfo = computeMoveAtr1d(series1d);
    const atr1d = moveInfo.atr14;
    const move1d = moveInfo.move1d;
    const move1dAtr14 = moveInfo.move1dAtr14;
    const absMove1dAtr14 = moveInfo.absMove1dAtr14;

    const levels = computePivotLevels(series1d.bars, levelLookback1d, atr1d);
    const supportLevel = levels.support?.level;
    const resistanceLevel = levels.resistance?.level;
    const close1d = series1d.bars.at(-1)?.c;
    const supportDistAtr =
      typeof close1d === "number" && typeof supportLevel === "number" && typeof atr1d === "number" && atr1d > 0
        ? (close1d - supportLevel) / atr1d
        : null;
    const resistanceDistAtr =
      typeof close1d === "number" && typeof resistanceLevel === "number" && typeof atr1d === "number" && atr1d > 0
        ? (resistanceLevel - close1d) / atr1d
        : null;

    const minHitsForSetup = PICK_POLICY.levelMinHitsForSetup;
    const supportHits = levels.support?.hits ?? 0;
    const resistanceHits = levels.resistance?.hits ?? 0;

    const nearSupport =
      supportHits >= minHitsForSetup &&
      typeof supportDistAtr === "number" &&
      supportDistAtr >= 0 &&
      supportDistAtr <= nearLevelMaxAtr;
    const nearResistance =
      resistanceHits >= minHitsForSetup &&
      typeof resistanceDistAtr === "number" &&
      resistanceDistAtr >= 0 &&
      resistanceDistAtr <= nearLevelMaxAtr;

    const participation = computeParticipation1d(series1d, atr1d);
    const hasParticipation = isParticipationBacked(participation, PICK_POLICY.participation);

    const close15 = series15m.bars.at(-1)?.c;
    const ema15 = Array.isArray(series15m.indicators.ema20)
      ? lastFiniteNumber(series15m.indicators.ema20, series15m.bars.length - 1)
      : null;
    const rsi15 = Array.isArray(series15m.indicators.rsi14)
      ? lastFiniteNumber(series15m.indicators.rsi14, series15m.bars.length - 1)
      : null;

    const trendStrength =
      typeof close15 === "number" && ema15 !== null && close15 !== 0
        ? Math.min(0.06, Math.abs((close15 - ema15) / close15))
        : 0;

    const nearLevel = (side === "buy" && nearSupport) || (side === "sell" && nearResistance);
    const trendAligned = sideTrend1d === side || sideTrend1h === side || sideTrend15 === side;
    const momentumSetup = (momentumAligned || strongDailyMomentumSide !== null) && hasParticipation;
    const explicitSetup = breakout !== null || momentumSetup || (nearLevel && trendAligned);

    let score = 0;
    score += Math.round(trendStrength * PICK_SCORE.trendStrengthScale);

    score += (signals15.length + signals1h.length + signals1d.length) * PICK_SCORE.signalCountBonus;

    if (typeof roc1d === "number") {
      score += Math.round(Math.min(PICK_SCORE.rocAbsMax["1d"], Math.abs(roc1d) * PICK_SCORE.rocAbsScale["1d"]));
    }
    if (typeof roc1h === "number") {
      score += Math.round(Math.min(PICK_SCORE.rocAbsMax["1h"], Math.abs(roc1h) * PICK_SCORE.rocAbsScale["1h"]));
    }
    if (typeof roc15 === "number") {
      score += Math.round(Math.min(PICK_SCORE.rocAbsMax["15m"], Math.abs(roc15) * PICK_SCORE.rocAbsScale["15m"]));
    }
    if (momentumAligned) {
      score += PICK_SCORE.momentumAlignedBonus;
    }

    if (breakout) {
      score += PICK_SCORE.breakoutBonus[breakout.window];
    }

    if (hasParticipation) {
      score += PICK_SCORE.participationBonus;
      if (
        participation.direction &&
        ((side === "buy" && participation.direction === "up") || (side === "sell" && participation.direction === "down"))
      ) {
        score += PICK_SCORE.participationDirectionBonus;
      }
    }

    if (side === "buy" && nearSupport) {
      score += PICK_SCORE.nearLevelBonus;
      const hits = levels.support?.hits;
      if (typeof hits === "number" && hits > 1) {
        score += Math.min(PICK_SCORE.nearLevelHitsBonusMax, (hits - 1) * PICK_SCORE.nearLevelHitsBonusPerHit);
      }
    }
    if (side === "sell" && nearResistance) {
      score += PICK_SCORE.nearLevelBonus;
      const hits = levels.resistance?.hits;
      if (typeof hits === "number" && hits > 1) {
        score += Math.min(PICK_SCORE.nearLevelHitsBonusMax, (hits - 1) * PICK_SCORE.nearLevelHitsBonusPerHit);
      }
    }

    if (absMove1dAtr14 !== null) {
      const baseBonus = absMove1dAtr14 * PICK_SCORE.moveAtrScale;
      const bigMoveBonus = absMove1dAtr14 >= PICK_SCORE.moveAtrBigMoveThreshold ? PICK_SCORE.moveAtrBigMoveBonus : 0;
      score += Math.round(Math.min(PICK_SCORE.moveAtrBonusMax, baseBonus + bigMoveBonus));
    }

    if (rsi15 !== null) {
      score += Math.round(
        Math.min(PICK_SCORE.rsiDeviationBonusMax, Math.abs(rsi15 - 50) / PICK_SCORE.rsiDeviationScaleDiv)
      );
    }

    const rationale: string[] = [];
    if (breakout) {
      const dirLabel = breakout.direction === "up" ? "above" : "below";
      rationale.push(`Breakout: close ${dirLabel} prior ${breakout.window}d level (${breakout.level.toFixed(2)}).`);
    }

    const momentumLabels: string[] = [];
    if (typeof roc15 === "number") {
      momentumLabels.push(`15m ${roc15 >= 0 ? "+" : ""}${(roc15 * 100).toFixed(1)}%`);
    }
    if (typeof roc1h === "number") {
      momentumLabels.push(`1h ${roc1h >= 0 ? "+" : ""}${(roc1h * 100).toFixed(1)}%`);
    }
    if (typeof roc1d === "number") {
      momentumLabels.push(`1d ${roc1d >= 0 ? "+" : ""}${(roc1d * 100).toFixed(1)}%`);
    }
    if (momentumLabels.length > 0) {
      rationale.push(`Momentum: ${momentumLabels.join(", ")}${momentumAligned ? " (aligned)" : ""}.`);
    }

    if (typeof supportLevel === "number" || typeof resistanceLevel === "number") {
      const parts: string[] = [];
      if (typeof supportLevel === "number") {
        const dist = typeof supportDistAtr === "number" ? ` (${supportDistAtr.toFixed(2)} ATR)` : "";
        const hits = typeof levels.support?.hits === "number" ? `, ${levels.support.hits} hits` : "";
        parts.push(`support ${supportLevel.toFixed(2)}${dist}${hits}`);
      }
      if (typeof resistanceLevel === "number") {
        const dist = typeof resistanceDistAtr === "number" ? ` (${resistanceDistAtr.toFixed(2)} ATR)` : "";
        const hits = typeof levels.resistance?.hits === "number" ? `, ${levels.resistance.hits} hits` : "";
        parts.push(`resistance ${resistanceLevel.toFixed(2)}${dist}${hits}`);
      }
      if (parts.length > 0) {
        rationale.push(`Levels (1d pivots): ${parts.join("; ")}.`);
      }
    }

    if (hasParticipation) {
      const dirLabel =
        participation.direction === "up" ? "demand" : participation.direction === "down" ? "supply" : "participation";
      const rangeLabel = typeof participation.rangeAtr === "number" ? `${participation.rangeAtr.toFixed(1)} ATR range` : "";
      const volLabel =
        typeof participation.volumeMultiple20 === "number" ? `${participation.volumeMultiple20.toFixed(1)}x vol` : "";
      const joiner = rangeLabel && volLabel ? ", " : "";
      rationale.push(`Supply/demand proxy: ${rangeLabel}${joiner}${volLabel} (${dirLabel}).`);
    }

    if (atr1d !== null) {
      let moveLabel = "";
      if (move1d !== null && absMove1dAtr14 !== null) {
        const quiet = absMove1dAtr14 < minTradeAbsMoveAtr ? " (quiet)" : "";
        moveLabel = `; 1d move ${move1d >= 0 ? "+" : ""}${move1d.toFixed(2)} (${absMove1dAtr14.toFixed(1)} ATR)${quiet}`;
      }
      rationale.push(`1d ATR14: ${atr1d.toFixed(2)}${moveLabel}`);
    }
    if (signals1d.length > 0) {
      rationale.push(`1d signals: ${signals1d.slice(0, 3).join("; ")}`);
    }
    if (signals1h.length > 0) {
      rationale.push(`1h signals: ${signals1h.slice(0, 3).join("; ")}`);
    }
    if (signals15.length > 0) {
      rationale.push(`15m signals: ${signals15.slice(0, 3).join("; ")}`);
    }
    if (sideTrend1d) {
      rationale.push(`1d trend bias: ${sideTrend1d === "buy" ? "bullish" : "bearish"}`);
    }
    if (!explicitSetup) {
      rationale.push("Trend-following watchlist setup (no breakout/momentum/level trigger on the latest bar).");
    } else if (!breakout && absMove1dAtr14 !== null && absMove1dAtr14 < minTradeAbsMoveAtr) {
      rationale.push("Setup present but 1d move < 1 ATR; kept on the watchlist.");
    }
    if (rationale.length === 0) {
      rationale.push("Trend continuation setup (no explicit rule hit on the latest bar).");
    }

    const trade = buildTradePlan(series15m, side, atr1d);

    candidates.push({
      symbol,
      basis: explicitSetup ? "signal" : "trend",
      score,
      trade,
      atr14_1d: atr1d,
      move1d,
      move1dAtr14,
      absMove1dAtr14,
      rationale,
      signals: {
        "15m": signals15,
        "1h": signals1h,
        "1d": signals1d
      },
      breakout,
      hasParticipation,
      dollarVolume1d
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  function stripCandidate(candidate: Candidate): ReportPick {
    const { absMove1dAtr14, breakout, hasParticipation, dollarVolume1d, ...pick } = candidate;
    void absMove1dAtr14;
    void breakout;
    void hasParticipation;
    void dollarVolume1d;
    return pick;
  }

  function isTechnicalTrade(candidate: Candidate): boolean {
    const moveOk = candidate.absMove1dAtr14 === null || candidate.absMove1dAtr14 >= minTradeAbsMoveAtr;
    const breakoutOk = candidate.breakout !== null && candidate.hasParticipation;
    return candidate.basis === "signal" && (moveOk || breakoutOk);
  }

  function isWatchlistEntry(candidate: Candidate, picked: Set<string>): boolean {
    if (picked.has(candidate.symbol)) {
      return false;
    }

    const subAtr = candidate.absMove1dAtr14 !== null && candidate.absMove1dAtr14 < minTradeAbsMoveAtr;
    return candidate.basis === "trend" || subAtr;
  }

  function hasDollarVolume1d(
    candidate: Candidate
  ): candidate is Candidate & { dollarVolume1d: NonNullable<Candidate["dollarVolume1d"]> } {
    return candidate.dollarVolume1d !== null;
  }

  const picks = candidates.filter(isTechnicalTrade).slice(0, REPORT_MAX_PICKS).map(stripCandidate);

  const pickSymbols = new Set(picks.map((p) => p.symbol));

  const watchlistCandidates = candidates.filter((c) => isWatchlistEntry(c, pickSymbols));

  // Bucket 1: explicit (signal-driven) setups that are still sub-ATR on the day.
  // These may not always be the top dollar-volume names, but they should be technically meaningful.
  const signalCandidates = watchlistCandidates
    .filter((c) => c.basis === "signal")
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, Math.min(REPORT_MAX_WATCHLIST, 4));

  const signalSymbols = new Set(signalCandidates.map((c) => c.symbol));
  const remainingSlots = Math.max(0, REPORT_MAX_WATCHLIST - signalCandidates.length);

  // Bucket 2: fill the remainder with the most-liquid names (dollar volume), biasing toward momentum/score.
  // When dollar volume is missing, fall back to score-based ordering (but rank those names last).
  const withDollarVolume = watchlistCandidates
    .filter((c) => !signalSymbols.has(c.symbol))
    .filter(hasDollarVolume1d)
    .sort((a, b) => b.dollarVolume1d - a.dollarVolume1d || b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, remainingSlots);

  const withoutDollarVolume = watchlistCandidates
    .filter((c) => !signalSymbols.has(c.symbol) && c.dollarVolume1d === null)
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, remainingSlots);

  const byDollarVolume = [...withDollarVolume, ...withoutDollarVolume].slice(0, remainingSlots);

  const watchlist = signalCandidates.concat(byDollarVolume).map(stripCandidate);

  return { picks, watchlist };
}

function attachPickNarratives(args: {
  picks: ReportPick[];
  kind: "pick" | "watchlist";
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>;
  newsBySymbol?: Record<string, MarketNewsSnapshot>;
}): ReportPick[] {
  const momentumLookback = PICK_POLICY.momentumLookback;
  const levelLookback1d = PICK_POLICY.levelLookback1d;

  return args.picks.map((pick) => {
    if (typeof pick.narrative === "string" && pick.narrative.trim() !== "") {
      return pick;
    }

    const symbol = pick.symbol;
    const series15m = args.analyzedBySymbol[symbol]?.["15m"];
    const series1h = args.analyzedBySymbol[symbol]?.["1h"];
    const series1d = args.analyzedBySymbol[symbol]?.["1d"];
    if (!series15m || !series1d) {
      return pick;
    }

    const breakout = detectDailyBreakout(series1d);
    const roc15 = computeRocPct(series15m.bars, momentumLookback["15m"]);
    const roc1h = series1h ? computeRocPct(series1h.bars, momentumLookback["1h"]) : null;
    const roc1d = computeRocPct(series1d.bars, momentumLookback["1d"]);
    const rocValues = [roc15, roc1h, roc1d].filter((v): v is number => typeof v === "number");
    const rocSigns = rocValues.map(sign).filter((s): s is -1 | 1 => s !== 0);
    const momentumAligned = rocSigns.length >= 2 && rocSigns.every((s) => s === rocSigns[0]);

    const atr1d = pick.atr14_1d ?? computeMoveAtr1d(series1d).atr14;
    const levels = computePivotLevels(series1d.bars, levelLookback1d, atr1d);
    const supportLevel = levels.support?.level;
    const resistanceLevel = levels.resistance?.level;
    const close1d = series1d.bars.at(-1)?.c;
    const supportDistAtr =
      typeof close1d === "number" && typeof supportLevel === "number" && typeof atr1d === "number" && atr1d > 0
        ? (close1d - supportLevel) / atr1d
        : null;
    const resistanceDistAtr =
      typeof close1d === "number" && typeof resistanceLevel === "number" && typeof atr1d === "number" && atr1d > 0
        ? (resistanceLevel - close1d) / atr1d
        : null;

    const narrative = buildPickNarrative({
      kind: args.kind,
      symbol,
      side: pick.trade.side,
      trade: pick.trade,
      breakout,
      momentum: {
        roc15,
        roc1h,
        roc1d,
        aligned: momentumAligned
      },
      atr1d,
      support:
        typeof supportLevel === "number"
          ? {
              level: supportLevel,
              distAtr: supportDistAtr,
              hits: levels.support?.hits ?? 0
            }
          : null,
      resistance:
        typeof resistanceLevel === "number"
          ? {
              level: resistanceLevel,
              distAtr: resistanceDistAtr,
              hits: levels.resistance?.hits ?? 0
            }
          : null,
      signals1d: pick.signals["1d"] ?? activeSignalLabels(series1d),
      analyzedBySymbol: args.analyzedBySymbol,
      news: args.newsBySymbol?.[symbol]
    });

    return { ...pick, narrative };
  });
}

function computeRegimeReadout(analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>): {
  regimeParts: string[];
  regimeLabel: string | null;
} {
  let breadthUp = 0;
  let breadthDown = 0;
  let breadthFlat = 0;
  let breadthTotal = 0;
  let breakoutsUp = 0;
  let breakoutsDown = 0;
  const dollarVolumes: Array<{ symbol: string; dollarVolume1d: number }> = [];

  for (const symbol of Object.keys(analyzedBySymbol)) {
    const series1d = analyzedBySymbol[symbol]?.["1d"];
    if (!series1d) {
      continue;
    }

    const last = series1d.bars.at(-1);
    const prev = series1d.bars.at(-2);
    if (last && prev && Number.isFinite(last.c) && Number.isFinite(prev.c) && prev.c !== 0) {
      const ret = (last.c - prev.c) / prev.c;
      breadthTotal += 1;
      if (ret > 0) {
        breadthUp += 1;
      } else if (ret < 0) {
        breadthDown += 1;
      } else {
        breadthFlat += 1;
      }
    }

    if (symbol !== "^VIX") {
      const breakout = detectDailyBreakout(series1d);
      if (breakout?.direction === "up") {
        breakoutsUp += 1;
      } else if (breakout?.direction === "down") {
        breakoutsDown += 1;
      }
    }

    if (last) {
      const dollarVolume1d = safeDollarVolume(last);
      if (dollarVolume1d !== null) {
        dollarVolumes.push({ symbol, dollarVolume1d });
      }
    }
  }

  const breadthPct = breadthTotal > 0 ? breadthUp / breadthTotal : null;

  dollarVolumes.sort((a, b) => b.dollarVolume1d - a.dollarVolume1d || a.symbol.localeCompare(b.symbol));
  const totalDollarVolume = dollarVolumes.reduce((sum, v) => sum + v.dollarVolume1d, 0);
  const top10DollarVolume = dollarVolumes.slice(0, 10).reduce((sum, v) => sum + v.dollarVolume1d, 0);
  const concentrationPct = totalDollarVolume > 0 ? top10DollarVolume / totalDollarVolume : null;

  const vixSeries = analyzedBySymbol["^VIX"]?.["1d"];
  const vixLast = vixSeries?.bars.at(-1);
  const vixPrev = vixSeries?.bars.at(-2);
  const vixClose = vixLast && Number.isFinite(vixLast.c) ? vixLast.c : null;
  const vixChangePct =
    vixLast && vixPrev && Number.isFinite(vixLast.c) && Number.isFinite(vixPrev.c) && vixPrev.c !== 0
      ? (vixLast.c - vixPrev.c) / vixPrev.c
      : null;

  const regimeParts: string[] = [];
  if (breadthTotal > 0) {
    const breadthPercentsExact = [breadthUp, breadthDown, breadthFlat].map((count) => (count * 100) / breadthTotal);
    const breadthPercentsRounded = breadthPercentsExact.map((pct) => Math.floor(pct));
    const breadthPercentsRemaining = 100 - breadthPercentsRounded.reduce((sum, pct) => sum + pct, 0);

    const breadthPercentsByRemainder = breadthPercentsExact
      .map((pct, idx) => ({ idx, remainder: pct - Math.floor(pct) }))
      .sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);

    for (let i = 0; i < breadthPercentsRemaining && i < breadthPercentsByRemainder.length; i += 1) {
      const idx = breadthPercentsByRemainder[i].idx;
      breadthPercentsRounded[idx] += 1;
    }

    const [breadthUpPct, breadthDownPct, breadthFlatPct] = breadthPercentsRounded;
    const flatLabel = breadthFlatPct > 0 ? ` / ${breadthFlatPct}% flat` : "";
    regimeParts.push(`breadth ${breadthUpPct}% up / ${breadthDownPct}% down${flatLabel}`);
  }
  if (vixClose !== null) {
    const vixPctLabel =
      vixChangePct !== null ? ` (${vixChangePct >= 0 ? "+" : ""}${(vixChangePct * 100).toFixed(1)}%)` : "";
    regimeParts.push(`VIX ${vixClose.toFixed(1)}${vixPctLabel}`);
  }
  if (concentrationPct !== null) {
    regimeParts.push(`top10 concentration ${(concentrationPct * 100).toFixed(0)}% of $vol`);
  }
  if (breakoutsUp + breakoutsDown > 0) {
    regimeParts.push(`breakouts ${breakoutsUp} up / ${breakoutsDown} down (20/55/252d)`);
  }

  let regimeLabel: string | null = null;
  if (breadthPct !== null && vixChangePct !== null) {
    if (breadthPct >= REGIME_POLICY.riskOn.breadthPctMin && vixChangePct <= REGIME_POLICY.riskOn.vixChangePctMax) {
      regimeLabel = "risk-on";
    } else if (breadthPct <= REGIME_POLICY.riskOff.breadthPctMax && vixChangePct >= REGIME_POLICY.riskOff.vixChangePctMin) {
      regimeLabel = "risk-off";
    } else {
      regimeLabel = "mixed";
    }
  } else if (breadthPct !== null) {
    regimeLabel =
      breadthPct >= REGIME_POLICY.riskOn.breadthPctMin
        ? "risk-on"
        : breadthPct <= REGIME_POLICY.riskOff.breadthPctMax
          ? "risk-off"
          : "mixed";
  }

  return { regimeParts, regimeLabel };
}

const MS_PER_DAY_UTC = 24 * 60 * 60 * 1000;
const YEAR_BOUNDARY_WINDOW_DAYS = 7;

function parseDateUtcNoon(date: string): Date {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid report date: ${date}. Expected format YYYY-MM-DD.`);
  }
  return d;
}

function diffDaysUtc(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY_UTC);
}

function buildSummaries(
  date: string,
  picks: ReportPick[],
  watchlist: ReportPick[],
  analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>>,
  missingSymbols: string[]
): MarketReport["summaries"] {
  // `date` is expected to be an NY calendar date in `YYYY-MM-DD` (validated upstream).
  // We pin to 12:00 UTC to avoid DST edge cases when mapping to America/New_York.
  const dateUtcNoon = parseDateUtcNoon(date);

  const isWeekendNy = (() => {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short"
    }).format(dateUtcNoon);
    return weekday === "Sat" || weekday === "Sun";
  })();

  const year = Number(date.slice(0, 4));
  const startOfYearUtcNoon = parseDateUtcNoon(`${year}-01-01`);
  const startOfNextYearUtcNoon = parseDateUtcNoon(`${year + 1}-01-01`);

  const daysSinceYearStart = diffDaysUtc(dateUtcNoon, startOfYearUtcNoon);
  const daysUntilNextYear = diffDaysUtc(startOfNextYearUtcNoon, dateUtcNoon);

  const isFirstWeekOfYear = daysSinceYearStart >= 0 && daysSinceYearStart <= YEAR_BOUNDARY_WINDOW_DAYS;
  const isFinalWeekOfYear = daysUntilNextYear >= 0 && daysUntilNextYear <= YEAR_BOUNDARY_WINDOW_DAYS;

  function median(values: number[]): number | null {
    const sorted = values.slice().sort((a, b) => a - b);
    if (sorted.length === 0) {
      return null;
    }

    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  function formatList(values: string[], max: number): string {
    if (values.length <= max) {
      return values.join(", ");
    }

    return `${values.slice(0, max).join(", ")}, …`;
  }

  function capWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      return text;
    }

    return `${words.slice(0, maxWords).join(" ")} …`;
  }

  function describeVolatility(medAbsMoveAtr: number): string {
    if (medAbsMoveAtr >= 1.5) {
      return "elevated";
    }
    if (medAbsMoveAtr >= 1.0) {
      return "active";
    }
    if (medAbsMoveAtr >= 0.6) {
      return "moderate";
    }
    return "muted";
  }

  const { regimeParts, regimeLabel } = computeRegimeReadout(analyzedBySymbol);

  const sentimentTone = coerceRiskTone(regimeLabel);

  const absMoveAtrValues: number[] = [];
  for (const symbol of Object.keys(analyzedBySymbol)) {
    const series1d = analyzedBySymbol[symbol]?.["1d"];
    if (!series1d) {
      continue;
    }

    const absMoveAtr = computeMoveAtr1d(series1d).absMove1dAtr14;
    if (absMoveAtr !== null) {
      absMoveAtrValues.push(absMoveAtr);
    }
  }

  const medAbsMoveAtr = median(absMoveAtrValues);
  const movedAtLeast1Atr = absMoveAtrValues.filter((v) => v >= 1).length;
  const movedAtLeast2Atr = absMoveAtrValues.filter((v) => v >= 2).length;

  const sentimentLines: string[] = [];
  if (regimeParts.length > 0) {
    sentimentLines.push(...regimeParts.slice(0, 2));
  }
  if (typeof medAbsMoveAtr === "number" && Number.isFinite(medAbsMoveAtr)) {
    const label = describeVolatility(medAbsMoveAtr);
    sentimentLines.push(`volatility ${label} (median ${medAbsMoveAtr.toFixed(1)} ATR)`);
  }

  const mainIdeaParts: string[] = [];
  if (regimeParts.length > 0) {
    const label = regimeLabel ? `${regimeLabel}` : null;
    mainIdeaParts.push(`${label ? `Risk tone was ${label}` : "Risk tone"}: ${regimeParts.join(", ")}.`);
  }
  if (medAbsMoveAtr !== null) {
    const label = describeVolatility(medAbsMoveAtr);
    mainIdeaParts.push(
      `Volatility was ${label} (median 1d move ${medAbsMoveAtr.toFixed(1)} ATR; ≥1 ATR: ${movedAtLeast1Atr}; ≥2 ATR: ${movedAtLeast2Atr}).`
    );
  }
  if (picks.length === 0) {
    mainIdeaParts.push(
      isWeekendNy
        ? "No high-conviction technical trades met the filter; focus is on broader context + watchlist levels for next week."
        : "No high-conviction technical trades met the filter today; focus is on watchlist follow-through."
    );
  } else {
    mainIdeaParts.push(
      `Top setups: ${picks
        .slice(0, REPORT_MAX_PICKS)
        .map((p) => `${p.symbol} ${p.trade.side}`)
        .join(", ")}.`
    );
  }

  const watchlistTake = (() => {
    if (watchlist.length === 0) {
      return isWeekendNy
        ? "Weekend stance: none flagged; staying selective into next week with a longer-term lens (weeks/months)."
        : "Watchlist stance: none flagged; staying selective into the next few sessions.";
    }

    const bias = getNarrativeWatchlistBias(watchlist);

    if (isWeekendNy) {
      return `Weekend stance: ${bias} bias, watching ${watchlist
        .slice(0, REPORT_MAX_WATCHLIST)
        .map((p) => p.symbol)
        .join(", ")} for follow-through over the next few weeks.`;
    }

    return `Watchlist stance: ${bias} bias, watching ${watchlist
      .slice(0, REPORT_MAX_WATCHLIST)
      .map((p) => p.symbol)
      .join(", ")} for follow-through.`;
  })();

  const veryShort = capWords(watchlistTake, REPORT_VERY_SHORT_MAX_WORDS);

  const summaryParts: string[] = [];
  summaryParts.push(`Report date: ${date}.`);

  if (isWeekendNy) {
    summaryParts.push(
      "Weekend note: focusing on broader market context and multi-week to quarterly levels (20/55/252d), not day-to-day noise."
    );
  }

  if (isWeekendNy && (isFinalWeekOfYear || isFirstWeekOfYear)) {
    const nextYearLabel = `${year + 1}-01-01`;
    summaryParts.push(
      `Calendar note: ${isFinalWeekOfYear ? `with ${nextYearLabel} coming up` : "early in the new year"}, expect positioning/rebalancing flows; prioritize clean weekly/monthly levels.`
    );
  }

  if (regimeParts.length > 0) {
    const label = regimeLabel ? `${regimeLabel}` : "mixed";
    summaryParts.push(`Market take: ${label} tone — ${regimeParts.join(", ")}.`);
  }
  if (medAbsMoveAtr !== null) {
    const label = describeVolatility(medAbsMoveAtr);
    summaryParts.push(
      `Volatility: ${label} (median 1d move ${medAbsMoveAtr.toFixed(1)} ATR; ≥1 ATR: ${movedAtLeast1Atr}; ≥2 ATR: ${movedAtLeast2Atr}).`
    );
  }

  if (picks.length > 0) {
    summaryParts.push("Technical trades:");
    for (const p of picks) {
      summaryParts.push(
        `- ${p.symbol}: ${p.trade.side.toUpperCase()} entry ${p.trade.entry.toFixed(2)}, stop ${p.trade.stop.toFixed(2)}`
      );
    }
  } else {
    summaryParts.push("Technical trades: none met the filter today.");
  }

  summaryParts.push(watchlistTake);

  if (watchlist.length > 0) {
    summaryParts.push("Watchlist:");
    for (const p of watchlist.slice(0, REPORT_MAX_WATCHLIST)) {
      const basis = p.basis === "trend" ? "trend" : p.basis === "signal" ? "sub-ATR signal" : "watchlist";
      summaryParts.push(`- ${p.symbol}: ${p.trade.side.toUpperCase()} (${basis})`);
    }
  }

  if (missingSymbols.length > 0) {
    summaryParts.push(`Missing symbols from provider (${missingSymbols.length}): ${formatList(missingSymbols, 12)}.`);
  }

  const rawSummary = summaryParts.join("\n");

  return {
    veryShort,
    mainIdea: capWords(mainIdeaParts.join(" ").trim(), 80),
    // 500-word cap per requirements.
    summary: capWords(rawSummary, 500),
    sentiment:
      sentimentLines.length > 0
        ? {
            tone: sentimentTone,
            lines: sentimentLines.slice(0, 3)
          }
        : undefined
  };
}

export function buildMarketReport(args: {
  date: string;
  symbols: string[];
  intervals: MarketInterval[];
  analyzed: AnalyzedSeries[];
  missingSymbols: string[];
  newsBySymbol?: Record<string, MarketNewsSnapshot>;
}): MarketReport {
  const seriesBySymbol: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>> = {};
  const analyzedBySymbol: Record<string, Partial<Record<MarketInterval, AnalyzedSeries>>> = {};
  for (const s of args.analyzed) {
    seriesBySymbol[s.symbol] ||= {};
    seriesBySymbol[s.symbol][s.interval] = toReportSeries(s, 220);

    analyzedBySymbol[s.symbol] ||= {};
    analyzedBySymbol[s.symbol][s.interval] = s;
  }

  const { picks: rawPicks, watchlist: rawWatchlist } = buildPicks({ analyzedBySymbol });
  const picks = attachPickNarratives({ picks: rawPicks, kind: "pick", analyzedBySymbol, newsBySymbol: args.newsBySymbol });
  const watchlist = attachPickNarratives({
    picks: rawWatchlist,
    kind: "watchlist",
    analyzedBySymbol,
    newsBySymbol: args.newsBySymbol
  });
  const mostActive = buildMostActive({ analyzedBySymbol });
  const summaries = buildSummaries(args.date, picks, watchlist, analyzedBySymbol, args.missingSymbols);

  return {
    date: args.date,
    generatedAt: new Date().toISOString(),
    symbols: args.symbols,
    intervals: args.intervals,
    missingSymbols: args.missingSymbols,
    picks,
    watchlist: watchlist.length > 0 ? watchlist : undefined,
    series: seriesBySymbol,
    mostActive,
    summaries
  };
}

function formatFrontmatterString(value: string): string {
  // Centralized frontmatter escaping; currently uses JSON-style quoting.
  return JSON.stringify(value);
}

export function buildReportMdx(report: MarketReport): string {
  // Builds a lean MDX report focused on highlights and actionable picks.
  // Picks render their own charts/indicator overlays; full universe/interval metadata and chart data are
  // also available in the JSON report.
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${formatFrontmatterString(`Market Report: ${report.date}`)}`);
  lines.push(`date: ${formatFrontmatterString(report.date)}`);
  lines.push(`generatedAt: ${formatFrontmatterString(report.generatedAt)}`);
  lines.push(`version: ${formatFrontmatterString("v2-highlights")}`);
  lines.push("---");
  lines.push("");
  // `ReportSummary` reads precomputed widgets from the report context (or derives them as a fallback).
  // Keeping MDX free of large data blobs keeps diffs readable.
  lines.push("<ReportSummary />");
  lines.push("");
  lines.push(`<CnbcVideoWidget date="${report.date}" />`);
  lines.push("");

  lines.push("## Technical trades");
  lines.push("");
  if (report.picks.length === 0) {
    lines.push("No clear trade setups today based on the configured rules + filters.");
    lines.push("");
  } else {
    for (const pick of report.picks) {
      lines.push(`### ${pick.symbol}`);
      lines.push("");
      lines.push(`<ReportPick symbol="${pick.symbol}" />`);
      lines.push("");
    }
  }

  lines.push("## Watchlist");
  lines.push("");

  const watchlistEntries = (report.watchlist ?? []).slice(0, REPORT_MAX_WATCHLIST);
  if (watchlistEntries.length === 0) {
    lines.push("No watchlist names stood out today; staying selective until volatility expands.");
    lines.push("");
  } else {
    for (const p of watchlistEntries) {
      const basis = p.basis === "trend" ? "trend" : p.basis === "signal" ? "sub-ATR signal" : "watchlist";
      const atrLabel =
        typeof p.move1dAtr14 === "number" && Number.isFinite(p.move1dAtr14)
          ? ` | ${Math.abs(p.move1dAtr14).toFixed(1)} ATR`
          : "";
      lines.push(`- ${p.symbol}: ${p.trade.side.toUpperCase()} (${basis})${atrLabel}`);
    }
    lines.push("");

    for (const pick of watchlistEntries) {
      lines.push(`### ${pick.symbol}`);
      lines.push("");
      lines.push(`<ReportPick symbol="${pick.symbol}" />`);
      lines.push("");
    }
  }

  lines.push("## Universe");
  lines.push("");
  lines.push("(Universe details live in the JSON report.)");
  lines.push("");
  lines.push("## Charts");
  lines.push("");
  lines.push("(Charts are rendered per-setup above; full series live in the JSON report.)");
  lines.push("");

  return `${lines.join("\n")}\n`;
}
