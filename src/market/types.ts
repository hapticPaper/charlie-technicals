export type MarketInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export const MARKET_INTERVALS: readonly MarketInterval[] = [
  "1m",
  "5m",
  "15m",
  "1h",
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
  high: number[];
  low: number[];
  sma20: Array<number | null>;
  ema20: Array<number | null>;
  rsi14: Array<number | null>;
  signals: SignalHit[];
};

export type TradeSide = "buy" | "sell";

export type TradePlan = {
  side: TradeSide;
  entry: number;
  stop: number;
  targets: number[];
};

export type ReportPick = {
  symbol: string;
  score: number;
  trade: TradePlan;
  rationale: string[];
  signals: Partial<Record<MarketInterval, string[]>>;
};

export type MarketReport = {
  date: string;
  generatedAt: string;
  symbols: string[];
  intervals: MarketInterval[];
  missingSymbols: string[];
  picks: ReportPick[];
  series: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>>;
  summaries: {
    veryShort: string;
    mainIdea: string;
    summary: string;
  };
};
