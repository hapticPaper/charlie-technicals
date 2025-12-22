export type MarketInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export const MARKET_INTERVALS: readonly MarketInterval[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d"
];

export type MarketBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type RawSeries = {
  symbol: string;
  interval: MarketInterval;
  provider: string;
  fetchedAt: string;
  bars: MarketBar[];
};

export type SignalHit = {
  id: string;
  label: string;
  active: boolean;
};

export type MacdSeries = {
  macd: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
};

export type AnalyzedSeries = {
  symbol: string;
  interval: MarketInterval;
  analyzedAt: string;
  bars: MarketBar[];
  indicators: Record<string, Array<number | null> | MacdSeries>;
  signals: SignalHit[];
};

export type ReportIntervalSeries = {
  symbol: string;
  interval: MarketInterval;
  t: number[];
  close: number[];
  sma20: Array<number | null>;
  ema20: Array<number | null>;
  rsi14: Array<number | null>;
  signals: SignalHit[];
};

export type AnalysisIntervalSummary = {
  analyzedAt: string;
  barCount: number;
  lastBarTime: string | null;
  lastClose: number | null;
  activeSignals: string[];
};

export type MarketAnalysisSummary = {
  schemaVersion: number;
  date: string;
  generatedAt: string;
  symbols: string[];
  intervals: MarketInterval[];

  /**
   * Symbols that had zero non-empty analyzed series across all configured intervals.
   */
  missingSymbols: string[];
  series: Record<string, Partial<Record<MarketInterval, AnalysisIntervalSummary>>>;
};

export type MarketReport = {
  date: string;
  generatedAt: string;
  symbols: string[];
  intervals: MarketInterval[];
  missingSymbols: string[];
  series: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>>;
  summaries: {
    veryShort: string;
    mainIdea: string;
    summary: string;
  };
};
