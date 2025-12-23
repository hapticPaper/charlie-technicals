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

/**
* Persisted news article used by analysis and visualization.
*/
export type MarketNewsArticle = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  relatedTickers: string[];
  topic?: string;
  hype?: number;
  mainIdea: string;
  summary: string;
};

/**
* Daily snapshot serialized to content/data/<SYMBOL>/news/<YYYYMMDD>.json.
*/
export type MarketNewsSnapshot = {
  symbol: string;
  provider: string;
  fetchedAt: string;
  asOfDate: string;
  articles: MarketNewsArticle[];
};

/**
* On-disk schema for CNBC video snapshots under content/data/cnbc/news/<YYYYMMDD>.json.
*
* Stored as a flat JSON array of `StoredCnbcVideoArticle` (no wrapper object).
*
* Historically, snapshots stored `symbol: "cnbc"` on every record; the read path
* normalizes that to `null`.
*
* `symbol` is the primary ticker symbol for the video when exactly one can be inferred;
* otherwise it's `null`.
*
* Changes here are backwards-incompatible with existing snapshot files.
*/
export type StoredCnbcVideoArticle = MarketNewsArticle & {
  provider: string;
  fetchedAt: string;
  asOfDate: string;
  symbol: string | null;
};

/**
* In-memory shape for CNBC video articles.
*
* `provider` is implied by the file path and omitted here.
* `symbol` is the primary ticker symbol for the video when exactly one can be inferred;
* otherwise it's `null`.
*/
export type CnbcVideoArticle = MarketNewsArticle & {
  fetchedAt: string;
  asOfDate: string;
  symbol: string | null;
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

export type BollingerBandsSeries = {
  middle: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
};

export type KeltnerChannelsSeries = {
  middle: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
};

export const SQUEEZE_STATES = ["on", "off", "neutral"] as const;

export type SqueezeState = (typeof SQUEEZE_STATES)[number];

export type TtmSqueezeSeries = {
  bollinger: BollingerBandsSeries;
  keltner: KeltnerChannelsSeries;
  squeezeOn: Array<boolean | null>;
  squeezeOff: Array<boolean | null>;
  squeezeState: Array<SqueezeState | null>;
  momentum: Array<number | null>;
};

export type IndicatorSeries =
  | Array<number | null>
  | MacdSeries
  | BollingerBandsSeries
  | KeltnerChannelsSeries
  | TtmSqueezeSeries;

export type AnalyzedSeries = {
  symbol: string;
  interval: MarketInterval;
  analyzedAt: string;
  bars: MarketBar[];
  indicators: Record<string, IndicatorSeries>;
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
  atr14?: Array<number | null>;
  bollinger20?: BollingerBandsSeries;
  keltner20?: KeltnerChannelsSeries;
  ttmSqueeze20?: TtmSqueezeSeries;
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
  atr14_1d?: number | null;
  move1d?: number | null;
  move1dAtr14?: number | null;
  rationale: string[];
  signals: Partial<Record<MarketInterval, string[]>>;
};

export type MostActiveEntry = {
  symbol: string;
  dollarVolume1d: number;
  dollarVolume5d: number;
  close: number;
  change1d: number | null;
  change1dPct: number | null;
  atr14: number | null;
  change1dAtr14: number | null;
  trendBias1d: TradeSide | null;
  signals1d: string[];
};

export type MarketReport = {
  date: string;
  generatedAt: string;
  symbols: string[];
  intervals: MarketInterval[];
  missingSymbols: string[];
  picks: ReportPick[];
  series: Record<string, Partial<Record<MarketInterval, ReportIntervalSeries>>>;
  mostActive?: {
    byDollarVolume1d: MostActiveEntry[];
    byDollarVolume5d: MostActiveEntry[];
  };
  summaries: {
    veryShort: string;
    mainIdea: string;
    summary: string;
  };
};

export type HighlightPick = {
  symbol: string;
  trade: Pick<TradePlan, "side" | "entry" | "stop">;
};

export type MarketReportHighlights = {
  version: "v2-highlights";
  date: string;
  generatedAt: string;
  picks: HighlightPick[];
  summaries: Pick<MarketReport["summaries"], "veryShort" | "mainIdea">;
};
