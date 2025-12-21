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

export type ReportPoint = {
  t: string;
  close: number;
  volume: number;
  sma20?: number;
  ema20?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
};

export type ReportIntervalSeries = {
  symbol: string;
  interval: MarketInterval;
  points: ReportPoint[];
  signals: SignalHit[];
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
