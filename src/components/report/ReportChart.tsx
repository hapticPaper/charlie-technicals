"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AreaData,
  AutoscaleInfo,
  CandlestickData,
  HistogramData,
  LineData,
  SeriesMarker,
  Time,
  UTCTimestamp,
  WhitespaceData
} from "lightweight-charts";

import type { ReportIntervalSeries, TradePlan } from "../../market/types";

import { BandCloudPrimitive, type BandCloudPoint } from "./BandCloudPrimitive";

type ChartAnnotations = {
  trade?: TradePlan;
};

// Shared price scale for candles and price-based overlays (SMA/EMA/BB/KC).
// All price overlays must use this scale so the price axis fits them.
const PRICE_SCALE_ID = "right" as const;

// Dedicated scales for non-price indicators.
const VOLUME_SCALE_ID = "volume" as const;
const RSI_SCALE_ID = "rsi" as const;
const MOMENTUM_SCALE_ID = "momentum" as const;
const SHADE_SCALE_ID = "shade" as const;

// Trade-level autoscaling padding when trade levels extend the candle range (tuned for equities).
// - `spanPadRatio`: symmetric pad as a % of the expanded range (2%).
// - `zeroSpanPadRatio`: when the expanded range is degenerate, pad as a % of price magnitude (0.2%).
// - `minPad`: absolute floor so very tight ranges don't look flat.
const TRADE_AUTOSCALE_PAD = {
  spanPadRatio: 0.02,
  zeroSpanPadRatio: 0.002,
  minPad: 0.001
} as const;

const TRADE_PRICE_SCALE_TOP_MARGIN = 0.08 as const;

function formatChartTime(time: Time | undefined, locale: string | undefined): string {
  const safeLocale = typeof locale === "string" && locale.length > 0 ? locale : undefined;

  if (!time) {
    return "";
  }

  if (typeof time === "number") {
    const millis = time * 1000;
    if (!Number.isFinite(millis)) {
      return "";
    }

    const dt = new Date(millis);
    if (!Number.isFinite(dt.getTime())) {
      return "";
    }
    return dt.toLocaleString(safeLocale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    const { year, month, day } = time as { year: number; month: number; day: number };
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isFinite(dt.getTime())) {
      return "";
    }

    return dt.toLocaleDateString(safeLocale, { month: "2-digit", day: "2-digit" });
  }

  return "";
}

function formatMaybeNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(2);
}

function extractSeriesValue(
  point:
    | LineData<UTCTimestamp>
    | CandlestickData<UTCTimestamp>
    | HistogramData<UTCTimestamp>
    | WhitespaceData<UTCTimestamp>
    | undefined
): number | undefined {
  if (!point) {
    return undefined;
  }

  if ("value" in point) {
    return point.value;
  }

  if ("close" in point) {
    return point.close;
  }

  return undefined;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function promoteAlpha(color: string, minAlpha = 0.85): string {
  const match = color.match(/^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  if (!match) {
    return color;
  }

  const alpha = Number(match[4]);
  if (!Number.isFinite(alpha) || alpha >= minAlpha) {
    return color;
  }

  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${minAlpha})`;
}

function resolveChartLocale(): string | undefined {
  const raw =
    typeof navigator !== "undefined"
      ? (navigator.languages && navigator.languages.length > 0 ? navigator.languages[0] : navigator.language)
      : undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }

  try {
    const normalized = raw.replace(/_/g, "-").split("@")[0];
    if (normalized.length === 0) {
      return undefined;
    }

    const canonical =
      typeof Intl !== "undefined" && typeof Intl.getCanonicalLocales === "function"
        ? Intl.getCanonicalLocales(normalized)[0]
        : normalized;

    return typeof canonical === "string" && canonical.length > 0 ? canonical : undefined;
  } catch {
    return undefined;
  }
}

/**
* Returns `color` as an `rgba(...)` value with a fixed alpha.
*
* Supported formats: `rgb(...)`, `rgba(...)`, `#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`.
* Any embedded alpha is ignored and replaced with the provided `alpha`.
* RGB channels are clamped to `[0,255]`. Only comma-separated `rgb/rgba` syntax is supported.
*
* If `alpha` is not finite, returns `color` unchanged.
*/
function withAlpha(color: string, alpha: number): string {
  if (!Number.isFinite(alpha)) {
    return color;
  }

  const safeAlpha = Math.max(0, Math.min(1, alpha));

  const clampRgbChannel = (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.max(0, Math.min(255, parsed));
  };

  const trimmed = color.trim();
  const isRgba = /^rgba\s*\(/i.test(trimmed);

  const rawHex = trimmed.startsWith("#") ? trimmed.slice(1) : null;
  const normalizedHex =
    rawHex !== null && (rawHex.length === 3 || rawHex.length === 4)
      ? rawHex
          .split("")
          .map((c) => c + c)
          .join("")
      : rawHex;
  const hasHexAlpha = normalizedHex !== null && normalizedHex.length === 8;

  // Normalize alpha-bearing inputs even when `safeAlpha === 1` so embedded alpha does not leak.
  if (safeAlpha >= 1 && !isRgba && !hasHexAlpha) {
    return color;
  }

  const rgbaMatch = trimmed.match(
    /^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i
  );
  if (rgbaMatch) {
    const r = clampRgbChannel(rgbaMatch[1]);
    const g = clampRgbChannel(rgbaMatch[2]);
    const b = clampRgbChannel(rgbaMatch[3]);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  const rgbMatch = trimmed.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgbMatch) {
    const r = clampRgbChannel(rgbMatch[1]);
    const g = clampRgbChannel(rgbMatch[2]);
    const b = clampRgbChannel(rgbMatch[3]);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  if (normalizedHex === null) {
    return color;
  }

  if (normalizedHex.length !== 6 && normalizedHex.length !== 8) {
    return color;
  }

  const r = Number.parseInt(normalizedHex.slice(0, 2), 16);
  const g = Number.parseInt(normalizedHex.slice(2, 4), 16);
  const b = Number.parseInt(normalizedHex.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) {
    return color;
  }

  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function toUtcTimestamp(t: number): UTCTimestamp | null {
  if (!Number.isFinite(t)) {
    return null;
  }

  const seconds = t > 10_000_000_000 ? t / 1000 : t;
  return Math.floor(seconds) as UTCTimestamp;
}

// Returns a UTC date key (YYYY-MM-DD) or null when the timestamp is invalid.
function formatUtcDateKey(t: number): string | null {
  if (!Number.isFinite(t)) {
    return null;
  }

  // Mirrors `toUtcTimestamp` normalization: accept ms or s, always operate on seconds.
  const tsSeconds = t > 10_000_000_000 ? t / 1000 : t;
  const millis = tsSeconds * 1000;
  if (!Number.isFinite(millis)) {
    return null;
  }

  const dt = new Date(millis);
  if (!Number.isFinite(dt.getTime())) {
    return null;
  }
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startIndexForLastUtcDays(t: number[], distinctDays: number): number {
  if (distinctDays <= 0 || t.length === 0) {
    return 0;
  }

  // Only stores valid YYYY-MM-DD keys; invalid timestamps are skipped.
  const seen = new Set<string>();
  let invalidTail = 0;
  const invalidTailWindow = 12;

  for (let i = t.length - 1; i >= 0; i -= 1) {
    const key = formatUtcDateKey(t[i]);
    if (key === null) {
      if (t.length - 1 - i < invalidTailWindow) {
        invalidTail += 1;
      }
      continue;
    }

    if (!seen.has(key)) {
      seen.add(key);
      if (seen.size > distinctDays) {
        if (invalidTail > 0 && process.env.NODE_ENV !== "production") {
          console.warn(`[ReportChart] skipped ${invalidTail} invalid timestamps near the series end`);
        }
        return i + 1;
      }
    }
  }

  if (invalidTail > 0 && process.env.NODE_ENV !== "production") {
    console.warn(`[ReportChart] skipped ${invalidTail} invalid timestamps near the series end`);
  }

  return 0;
}

function deriveOpenFromClose(close: number[]): number[] {
  if (close.length === 0) {
    return [];
  }

  const out = new Array<number>(close.length);
  out[0] = close[0];

  for (let i = 1; i < close.length; i += 1) {
    out[i] = close[i - 1];
  }

  return out;
}

function toHeikinAshiCandles(args: {
  t: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
}): {
  candles: Array<CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>>;
  haOpen: Array<number | null>;
  haClose: Array<number | null>;
} {
  const len = Math.min(args.t.length, args.open.length, args.high.length, args.low.length, args.close.length);
  const candles: Array<CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> = [];
  const haOpen = new Array<number | null>(len).fill(null);
  const haClose = new Array<number | null>(len).fill(null);

  let prevHaOpen: number | null = null;
  let prevHaClose: number | null = null;

  for (let i = 0; i < len; i += 1) {
    const time = toUtcTimestamp(args.t[i]);
    if (time === null) {
      continue;
    }

    const o = args.open[i];
    const h = args.high[i];
    const l = args.low[i];
    const c = args.close[i];
    if (![o, h, l, c].every((v) => typeof v === "number" && Number.isFinite(v))) {
      candles.push({ time });
      continue;
    }

    const curHaClose: number = (o + h + l + c) / 4;
    const curHaOpen: number =
      prevHaOpen !== null && prevHaClose !== null ? (prevHaOpen + prevHaClose) / 2 : (o + c) / 2;
    const curHaHigh = Math.max(h, curHaOpen, curHaClose);
    const curHaLow = Math.min(l, curHaOpen, curHaClose);

    haOpen[i] = curHaOpen;
    haClose[i] = curHaClose;
    prevHaOpen = curHaOpen;
    prevHaClose = curHaClose;

    candles.push({ time, open: curHaOpen, high: curHaHigh, low: curHaLow, close: curHaClose });
  }

  return { candles, haOpen, haClose };
}

function defaultVisibleRange(series: ReportIntervalSeries): { from: number; to: number } | null {
  const len = series.t.length;
  if (len <= 1) {
    return null;
  }

  if (series.interval === "1d") {
    // 34 prior candles + the most recent candle.
    // Assumes `series.t` is sorted oldest-first (newest-last) and that 1 candle maps to 1 trading day.
    // For symbols with shorter history, this shows all available candles.
    const priorCandles = 34;
    const currentCandle = 1;
    const targetVisibleCandles = priorCandles + currentCandle;
    const points = Math.min(targetVisibleCandles, len);
    const rightBuffer = 1;
    const from = Math.max(0, len - points);
    // `to` intentionally exceeds the last series index to create a right-side buffer.
    return { from, to: len - 1 + rightBuffer };
  }

  if (series.interval === "15m") {
    // Show the most recent 2 distinct UTC calendar days that have data:
    // typically "prior trading day" + "current trading day" for active markets.
    // Note: weekends/holidays (no candles) are naturally skipped.
    const from = startIndexForLastUtcDays(series.t, 2);
    const rightBuffer = 8;
    // `to` intentionally exceeds the last series index to create a right-side buffer.
    return { from, to: len - 1 + rightBuffer };
  }

  return null;
}

function toLineSeriesData(
  t: number[],
  values: Array<number | null>
): Array<LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> {
  const out: Array<LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> = [];
  const len = Math.min(t.length, values.length);

  for (let i = 0; i < len; i += 1) {
    const time = toUtcTimestamp(t[i]);
    if (time === null) {
      continue;
    }

    const value = values[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      out.push({ time });
      continue;
    }

    out.push({ time, value });
  }

  return out;
}

function toAreaShadeSeriesData(
  t: number[],
  shouldShade: Array<boolean | null>
): Array<AreaData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> {
  const out: Array<AreaData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> = [];
  const len = Math.min(t.length, shouldShade.length);

  for (let i = 0; i < len; i += 1) {
    const time = toUtcTimestamp(t[i]);
    if (time === null) {
      continue;
    }

    if (shouldShade[i] !== true) {
      out.push({ time });
      continue;
    }

    out.push({ time, value: 1 });
  }

  return out;
}

function toBandCloudPoints(
  t: number[],
  upper: Array<number | null>,
  lower: Array<number | null>
): BandCloudPoint[] {
  const out: BandCloudPoint[] = [];
  const len = Math.min(t.length, upper.length, lower.length);

  for (let i = 0; i < len; i += 1) {
    const time = toUtcTimestamp(t[i]);
    if (time === null) {
      continue;
    }

    const u = upper[i];
    const l = lower[i];
    out.push({
      time,
      upper: typeof u === "number" && Number.isFinite(u) ? u : null,
      lower: typeof l === "number" && Number.isFinite(l) ? l : null
    });
  }

  return out;
}

function toHistogramSeriesData(
  t: number[],
  values: Array<number | null>,
  colorForIndex: (idx: number) => string
): Array<HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> {
  const out: Array<HistogramData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> = [];
  const len = Math.min(t.length, values.length);

  for (let i = 0; i < len; i += 1) {
    const time = toUtcTimestamp(t[i]);
    if (time === null) {
      continue;
    }

    const value = values[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      out.push({ time });
      continue;
    }

    out.push({ time, value, color: colorForIndex(i) });
  }

  return out;
}

function buildSqueezeMarkers(series: ReportIntervalSeries): SeriesMarker<UTCTimestamp>[] {
  const squeezeState = series.ttmSqueeze20?.squeezeState;
  if (!squeezeState || squeezeState.length !== series.t.length) {
    return [];
  }

  const onColor = promoteAlpha(readCssVar("--rp-squeeze-on", readCssVar("--rp-warn", "#f59e0b")));
  const offColor = promoteAlpha(readCssVar("--rp-squeeze-off", readCssVar("--rp-bull", "#22c55e")));

  const markers: SeriesMarker<UTCTimestamp>[] = [];
  let active: "on" | "off" | null = null;
  let start = 0;

  function pushSegment(state: "on" | "off", startIdx: number, endIdx: number) {
    if (endIdx <= startIdx) {
      return;
    }

    const mid = Math.floor((startIdx + endIdx) / 2);
    const time = toUtcTimestamp(series.t[mid]);
    if (time === null) {
      return;
    }

    markers.push({
      time,
      position: "belowBar",
      color: state === "on" ? onColor : offColor,
      shape: state === "on" ? "circle" : "square",
      size: 1,
      text: state === "on" ? "SQ" : undefined
    });
  }

  for (let i = 0; i < squeezeState.length; i += 1) {
    const stateRaw = squeezeState[i];
    const state = stateRaw === "on" ? "on" : stateRaw === "off" ? "off" : null;

    if (active === null) {
      if (state) {
        active = state;
        start = i;
      }
      continue;
    }

    if (state !== active) {
      pushSegment(active, start, i - 1);

      if (state) {
        active = state;
        start = i;
      } else {
        active = null;
      }
    }
  }

  if (active) {
    pushSegment(active, start, squeezeState.length - 1);
  }

  return markers;
}

export function ReportChart(props: {
  title?: string;
  series: ReportIntervalSeries;
  annotations?: ChartAnnotations;
  showSignals?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { series, annotations } = props;

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const squeezeMarkers = useMemo(() => buildSqueezeMarkers(series), [series]);

  const active = series.signals.filter((s) => s.active).map((s) => s.label);
  const trade = annotations?.trade;
  const isBuy = trade?.side === "buy";

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const wrapper = wrapperRef.current;
    const chartEl = chartRef.current;
    const tooltip = tooltipRef.current;

    if (!wrapper || !chartEl) {
      return;
    }

    const chartElement = chartEl;

    let disposed = false;
    let cleanup = () => {};

    async function run() {
      const {
        ColorType,
        AreaSeries,
        CandlestickSeries,
        CrosshairMode,
        HistogramSeries,
        LineSeries,
        LineStyle,
        createChart,
        createImageWatermark,
        createSeriesMarkers
      } = await import("lightweight-charts");
      if (disposed) {
        return;
      }

      const chartLocale = resolveChartLocale();

      const surface = readCssVar("--rp-surface", "rgba(255, 255, 255, 0.06)");
      const border = readCssVar("--rp-border", "rgba(255, 255, 255, 0.12)");
      const grid = readCssVar("--rp-grid", "rgba(255, 255, 255, 0.08)");
      const text = readCssVar("--rp-text", "#e5e7eb");
      const muted = readCssVar("--rp-muted", "#a1a1aa");

      const smaColor = readCssVar("--rp-sma", "#38bdf8");
      const emaColor = readCssVar("--rp-ema", "#a78bfa");
      const rsiColor = readCssVar("--rp-rsi", "#34d399");
      const bollingerColor = readCssVar("--rp-bollinger", "#60a5fa");
      const keltnerColor = readCssVar("--rp-keltner", "#f472b6");
      const bull = readCssVar("--rp-bull", "#22c55e");
      const bear = readCssVar("--rp-bear", "#fb7185");
      const warn = readCssVar("--rp-warn", "#f59e0b");
      const target = readCssVar("--rp-target", "#38bdf8");

      const squeezeOnShade = withAlpha(warn, 0.08);
      const squeezeOffShade = withAlpha(bull, 0.08);

      const hasVolume =
        Array.isArray(series.volume) &&
        series.volume.length === series.t.length &&
        series.volume.some((v) => typeof v === "number" && Number.isFinite(v));

      const hasSqueeze =
        Array.isArray(series.ttmSqueeze20?.squeezeState) &&
        series.ttmSqueeze20.squeezeState.length === series.t.length;
      const hasMomentum =
        Array.isArray(series.ttmSqueeze20?.momentum) &&
        series.ttmSqueeze20.momentum.length === series.t.length &&
        series.ttmSqueeze20.momentum.some((v) => typeof v === "number" && Number.isFinite(v));

      const tradePrices = trade
        ? [trade.entry, trade.stop, ...(trade.targets ?? [])].filter(
            (value): value is number => typeof value === "number" && Number.isFinite(value)
          )
        : [];

      const candleHighs = Array.isArray(series.high) ? series.high : [];
      const maxCandleHigh = candleHighs.reduce((max, value) => {
        return typeof value === "number" && Number.isFinite(value) ? Math.max(max, value) : max;
      }, Number.NEGATIVE_INFINITY);
      const maxTradePrice = tradePrices.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);

      // Use ">=" so trade levels exactly at the candle high still get headroom (avoids line/label clipping).
      const priceScaleTopMargin =
        tradePrices.length > 0 && Number.isFinite(maxCandleHigh) && maxTradePrice >= maxCandleHigh
          ? TRADE_PRICE_SCALE_TOP_MARGIN
          : 0;
      const priceScaleMargins = hasVolume
        ? { top: priceScaleTopMargin, bottom: 0.38 }
        : { top: priceScaleTopMargin, bottom: 0.3 };
      const volumeScaleMargins = hasVolume ? { top: 0.62, bottom: 0.2 } : null;
      const rsiScaleMargins = hasVolume ? { top: 0.8, bottom: 0 } : { top: 0.7, bottom: 0 };

      const chart = createChart(chartElement, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: surface },
          textColor: text,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'"
        },
        grid: {
          vertLines: { color: grid },
          horzLines: { color: grid }
        },
        rightPriceScale: {
          borderColor: border,
          textColor: muted,
          scaleMargins: priceScaleMargins
        },
        timeScale: {
          borderColor: border,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 0
        },
        localization: {
          locale: chartLocale
        },
        crosshair: {
          mode: CrosshairMode.Magnet
        }
      });

      function escapeSvgText(value: string): string {
        return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      }

      const MAIN_PANE_INDEX = 0;
      const pane = chart.panes()[MAIN_PANE_INDEX];
      const watermarkSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="170">` +
        `<style>text{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;}</style>` +
        `<text x="100%" y="68" text-anchor="end" font-size="72" font-weight="700" fill="#ffffff">${escapeSvgText(
          series.symbol
        )}</text>` +
        `<text x="100%" y="140" text-anchor="end" font-size="46" font-weight="700" fill="#ffffff">${escapeSvgText(
          series.interval
        )}</text>` +
        `</svg>`;
      const watermarkPlugin = pane
        ? createImageWatermark(
            pane,
            `data:image/svg+xml,${encodeURIComponent(watermarkSvg)}`,
            {
              alpha: 0.12,
              padding: 12,
              maxWidth: 420
            }
          )
        : null;

      let didCleanup = false;

      // Squeeze shading is meant to act like a background wash. lightweight-charts draws later-added
      // series on top, so keep these shade AreaSeries created before the candlesticks.
      const squeezeOnShadeSeries = hasSqueeze
        ? chart.addSeries(
            AreaSeries,
            {
              topColor: squeezeOnShade,
              bottomColor: squeezeOnShade,
              lineColor: "transparent",
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
              priceScaleId: SHADE_SCALE_ID,
              autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } })
            },
            MAIN_PANE_INDEX
          )
        : null;
      const squeezeOffShadeSeries = hasSqueeze
        ? chart.addSeries(
            AreaSeries,
            {
              topColor: squeezeOffShade,
              bottomColor: squeezeOffShade,
              lineColor: "transparent",
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
              priceScaleId: SHADE_SCALE_ID,
              autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } })
            },
            MAIN_PANE_INDEX
          )
        : null;

      // Hidden host series for primitives (band clouds). Added after squeeze shading so clouds render above the wash.
      // Uses close values (the basis for BB/KC calculations) to stay aligned with the price scale.
      const hasBollinger = Boolean(series.bollinger20);
      const hasKeltner = Boolean(series.keltner20);
      const cloudAnchorSeries = hasBollinger || hasKeltner
        ? chart.addSeries(
            LineSeries,
            {
              color: "transparent",
              lineWidth: 1,
              lineVisible: false,
              crosshairMarkerVisible: false,
              priceScaleId: PRICE_SCALE_ID,
              priceLineVisible: false,
              lastValueVisible: false
            },
            MAIN_PANE_INDEX
          )
        : null;

      const priceSeries = chart.addSeries(CandlestickSeries, {
        upColor: bull,
        downColor: bear,
        wickUpColor: bull,
        wickDownColor: bear,
        borderVisible: false,
        priceScaleId: PRICE_SCALE_ID,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: (baseImplementation: () => AutoscaleInfo | null) => {
          const base = baseImplementation();
          if (!base || !base.priceRange || tradePrices.length === 0) {
            return base;
          }

          const baseMin = base.priceRange.minValue;
          const baseMax = base.priceRange.maxValue;

          let minValue = baseMin;
          let maxValue = baseMax;

          for (const value of tradePrices) {
            minValue = Math.min(minValue, value);
            maxValue = Math.max(maxValue, value);
          }

          if (minValue === baseMin && maxValue === baseMax) {
            return base;
          }

          // Only apply additional padding when trades extend beyond the base candle range.
          const span = maxValue - minValue;
          let pad: number;
          if (span > 0) {
            const rawPad = span * TRADE_AUTOSCALE_PAD.spanPadRatio;
            pad = Math.max(rawPad, TRADE_AUTOSCALE_PAD.minPad);
          } else {
            const maxMagnitude = Math.max(Math.abs(minValue), Math.abs(maxValue));
            pad =
              maxMagnitude === 0
                ? TRADE_AUTOSCALE_PAD.minPad
                : Math.max(TRADE_AUTOSCALE_PAD.minPad, maxMagnitude * TRADE_AUTOSCALE_PAD.zeroSpanPadRatio);
          }

          return {
            ...base,
            priceRange: {
              minValue: minValue - pad,
              maxValue: maxValue + pad
            }
          };
        }
      }, MAIN_PANE_INDEX);
      const smaSeries = chart.addSeries(LineSeries, {
        color: smaColor,
        lineWidth: 1,
        priceScaleId: PRICE_SCALE_ID,
        priceLineVisible: false,
        lastValueVisible: false
      }, MAIN_PANE_INDEX);
      const emaSeries = chart.addSeries(LineSeries, {
        color: emaColor,
        lineWidth: 1,
        priceScaleId: PRICE_SCALE_ID,
        priceLineVisible: false,
        lastValueVisible: false
      }, MAIN_PANE_INDEX);

      const bbUpperSeries = hasBollinger
        ? chart.addSeries(LineSeries, {
            color: bollingerColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceScaleId: PRICE_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false
          }, MAIN_PANE_INDEX)
        : null;
      const bbLowerSeries = hasBollinger
        ? chart.addSeries(LineSeries, {
            color: bollingerColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceScaleId: PRICE_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false
          }, MAIN_PANE_INDEX)
        : null;
      const kcUpperSeries = hasKeltner
        ? chart.addSeries(LineSeries, {
            color: keltnerColor,
            lineWidth: 1,
            lineStyle: LineStyle.SparseDotted,
            priceScaleId: PRICE_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false
          }, MAIN_PANE_INDEX)
        : null;
      const kcLowerSeries = hasKeltner
        ? chart.addSeries(LineSeries, {
            color: keltnerColor,
            lineWidth: 1,
            lineStyle: LineStyle.SparseDotted,
            priceScaleId: PRICE_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false
          }, MAIN_PANE_INDEX)
        : null;

      const bbCloud = cloudAnchorSeries && bbUpperSeries && bbLowerSeries
        ? new BandCloudPrimitive({
            fillColor: withAlpha(muted, 0.18),
            zOrder: "normal"
          })
        : null;
      const kcCloud = cloudAnchorSeries && kcUpperSeries && kcLowerSeries
        ? new BandCloudPrimitive({
            fillColor: withAlpha(warn, 0.16),
            zOrder: "normal"
          })
        : null;

      if (bbCloud && cloudAnchorSeries) {
        cloudAnchorSeries.attachPrimitive(bbCloud);
      }
      if (kcCloud && cloudAnchorSeries) {
        cloudAnchorSeries.attachPrimitive(kcCloud);
      }

      const volumeSeries = hasVolume
        ? chart.addSeries(HistogramSeries, {
            priceScaleId: VOLUME_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false
          }, MAIN_PANE_INDEX)
        : null;

      const rsiSeries = chart.addSeries(LineSeries, {
        color: rsiColor,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceScaleId: RSI_SCALE_ID,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
      }, MAIN_PANE_INDEX);

      const momentumSeries = hasMomentum
        ? chart.addSeries(HistogramSeries, {
            priceScaleId: MOMENTUM_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false,
            base: 0
          }, MAIN_PANE_INDEX)
        : null;

      const trendSeries = chart.addSeries(LineSeries, {
        color: muted,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceScaleId: PRICE_SCALE_ID,
        priceLineVisible: false,
        lastValueVisible: false
      }, MAIN_PANE_INDEX);

      if (hasSqueeze) {
        chart.priceScale(SHADE_SCALE_ID).applyOptions({
          scaleMargins: priceScaleMargins,
          visible: false
        });
      }

      chart.priceScale(RSI_SCALE_ID).applyOptions({
        scaleMargins: rsiScaleMargins,
        visible: false
      });

      if (momentumSeries) {
        chart.priceScale(MOMENTUM_SCALE_ID).applyOptions({
          scaleMargins: rsiScaleMargins,
          visible: false
        });
      }

      if (volumeSeries && volumeScaleMargins) {
        chart.priceScale(VOLUME_SCALE_ID).applyOptions({
          scaleMargins: volumeScaleMargins,
          visible: false
        });
      }

      const open =
        Array.isArray(series.open) && series.open.length === series.t.length
          ? series.open
          : deriveOpenFromClose(series.close);
      const ha = toHeikinAshiCandles({ t: series.t, open, high: series.high, low: series.low, close: series.close });

      priceSeries.setData(ha.candles);
      cloudAnchorSeries?.setData(toLineSeriesData(series.t, series.close));
      smaSeries.setData(toLineSeriesData(series.t, series.sma20));
      emaSeries.setData(toLineSeriesData(series.t, series.ema20));
      bbUpperSeries?.setData(toLineSeriesData(series.t, series.bollinger20?.upper ?? []));
      bbLowerSeries?.setData(toLineSeriesData(series.t, series.bollinger20?.lower ?? []));
      kcUpperSeries?.setData(toLineSeriesData(series.t, series.keltner20?.upper ?? []));
      kcLowerSeries?.setData(toLineSeriesData(series.t, series.keltner20?.lower ?? []));
      rsiSeries.setData(toLineSeriesData(series.t, series.rsi14));

      bbCloud?.setData(
        toBandCloudPoints(series.t, series.bollinger20?.upper ?? [], series.bollinger20?.lower ?? [])
      );
      kcCloud?.setData(
        toBandCloudPoints(series.t, series.keltner20?.upper ?? [], series.keltner20?.lower ?? [])
      );

      if (hasSqueeze && series.ttmSqueeze20?.squeezeState) {
        squeezeOnShadeSeries?.setData(
          toAreaShadeSeriesData(
            series.t,
            series.ttmSqueeze20.squeezeState.map((s) => s === "on")
          )
        );
        squeezeOffShadeSeries?.setData(
          toAreaShadeSeriesData(
            series.t,
            series.ttmSqueeze20.squeezeState.map((s) => s === "off")
          )
        );
      }

      if (momentumSeries && hasMomentum && series.ttmSqueeze20?.momentum) {
        const values = series.ttmSqueeze20.momentum;
        let absMax = 0;
        for (const v of values) {
          if (typeof v === "number" && Number.isFinite(v)) {
            absMax = Math.max(absMax, Math.abs(v));
          }
        }
        if (!Number.isFinite(absMax) || absMax <= 0) {
          absMax = 1;
        }

        momentumSeries.applyOptions({
          autoscaleInfoProvider: () => ({ priceRange: { minValue: -absMax, maxValue: absMax } })
        });

        momentumSeries.setData(
          toHistogramSeriesData(series.t, values, (idx) => {
            const v = values[idx];
            if (typeof v !== "number" || !Number.isFinite(v)) {
              return promoteAlpha(muted, 0.4);
            }
            return promoteAlpha(v >= 0 ? bull : bear, 0.45);
          })
        );
      }

      const trendCandles = series.interval === "15m" ? 96 : 55;
      const trendLen = Math.min(series.t.length, series.close.length);
      if (trendLen >= 2) {
        const end = trendLen - 1;
        const start = Math.max(0, end - trendCandles);
        const startTime = toUtcTimestamp(series.t[start]);
        const endTime = toUtcTimestamp(series.t[end]);
        const startValue = series.close[start];
        const endValue = series.close[end];

        if (startTime !== null && endTime !== null && [startValue, endValue].every((v) => Number.isFinite(v))) {
          trendSeries.setData([
            { time: startTime, value: startValue },
            { time: endTime, value: endValue }
          ]);
        }
      }

      if (volumeSeries && hasVolume && series.volume) {
        volumeSeries.setData(
          toHistogramSeriesData(series.t, series.volume, (idx) => {
            const haO = ha.haOpen[idx];
            const haC = ha.haClose[idx];
            const ok = typeof haO === "number" && Number.isFinite(haO) && typeof haC === "number" && Number.isFinite(haC);

            if (idx === 0) {
              // First bar has no prior Heikin Ashi state: treat finite candles as "up" and missing data as muted.
              return promoteAlpha(ok ? bull : muted, 0.65);
            }

            if (!ok) {
              return promoteAlpha(muted, 0.65);
            }

            return promoteAlpha(haC >= haO ? bull : bear, 0.65);
          })
        );
      }

      const squeezeMarkerPlugin =
        squeezeMarkers.length > 0
          ? createSeriesMarkers(priceSeries, squeezeMarkers, { autoScale: false, zOrder: "aboveSeries" })
          : null;

      if (trade) {
        priceSeries.createPriceLine({
          price: trade.entry,
          color: isBuy ? bull : bear,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: `Entry ${trade.entry.toFixed(2)}`
        });
        priceSeries.createPriceLine({
          price: trade.stop,
          color: warn,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: `Stop ${trade.stop.toFixed(2)}`
        });
        trade.targets?.forEach((t, idx) => {
          priceSeries.createPriceLine({
            price: t,
            color: target,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            title: `T${idx + 1} ${t.toFixed(2)}`
          });
        });
      }

      rsiSeries.createPriceLine({ price: 70, color: border, lineStyle: LineStyle.Dotted, lineWidth: 1, title: "70" });
      rsiSeries.createPriceLine({ price: 30, color: border, lineStyle: LineStyle.Dotted, lineWidth: 1, title: "30" });

      const range = defaultVisibleRange(series);
      if (range) {
        chart.timeScale().setVisibleLogicalRange(range);
      } else {
        chart.timeScale().fitContent();
      }

      if (tooltip) {
        tooltip.style.whiteSpace = "pre";
        tooltip.style.color = text;
        tooltip.style.pointerEvents = "none";
        tooltip.style.background = surface;
        tooltip.style.border = `1px solid ${border}`;
        tooltip.style.borderRadius = "10px";
        tooltip.style.padding = "8px 10px";
        tooltip.style.fontSize = "12px";
        tooltip.style.opacity = "0";
      }

      chart.subscribeCrosshairMove((param) => {
        if (!tooltip) {
          return;
        }

        const timeLabel = formatChartTime(param.time, chartLocale);
        if (!param.point || !timeLabel) {
          tooltip.style.opacity = "0";
          return;
        }

        const price = param.seriesData.get(priceSeries) as
          | CandlestickData<UTCTimestamp>
          | WhitespaceData<UTCTimestamp>
          | undefined;
        const sma = param.seriesData.get(smaSeries) as
          | LineData<UTCTimestamp>
          | WhitespaceData<UTCTimestamp>
          | undefined;
        const ema = param.seriesData.get(emaSeries) as
          | LineData<UTCTimestamp>
          | WhitespaceData<UTCTimestamp>
          | undefined;
        const bbU = bbUpperSeries
          ? (param.seriesData.get(bbUpperSeries) as
              | LineData<UTCTimestamp>
              | WhitespaceData<UTCTimestamp>
              | undefined)
          : undefined;
        const bbL = bbLowerSeries
          ? (param.seriesData.get(bbLowerSeries) as
              | LineData<UTCTimestamp>
              | WhitespaceData<UTCTimestamp>
              | undefined)
          : undefined;
        const kcU = kcUpperSeries
          ? (param.seriesData.get(kcUpperSeries) as
              | LineData<UTCTimestamp>
              | WhitespaceData<UTCTimestamp>
              | undefined)
          : undefined;
        const kcL = kcLowerSeries
          ? (param.seriesData.get(kcLowerSeries) as
              | LineData<UTCTimestamp>
              | WhitespaceData<UTCTimestamp>
              | undefined)
          : undefined;
        const rsi = param.seriesData.get(rsiSeries) as
          | LineData<UTCTimestamp>
          | WhitespaceData<UTCTimestamp>
          | undefined;
        const vol = volumeSeries
          ? (param.seriesData.get(volumeSeries) as
              | HistogramData<UTCTimestamp>
              | WhitespaceData<UTCTimestamp>
              | undefined)
          : undefined;

        const haOhlc =
          price && "close" in price
            ? `${formatMaybeNumber(price.open)} / ${formatMaybeNumber(price.high)} / ${formatMaybeNumber(price.low)} / ${formatMaybeNumber(price.close)}`
            : "—";

        const lines = [
          timeLabel,
          `HA close: ${formatMaybeNumber(extractSeriesValue(price))}`,
          `HA O/H/L/C: ${haOhlc}`,
          `SMA 20: ${formatMaybeNumber(extractSeriesValue(sma))}`,
          `EMA 20: ${formatMaybeNumber(extractSeriesValue(ema))}`,
          `RSI 14: ${formatMaybeNumber(extractSeriesValue(rsi))}`
        ];
        if (bbUpperSeries && bbLowerSeries) {
          lines.push(
            `BB U/L: ${formatMaybeNumber(extractSeriesValue(bbU))} / ${formatMaybeNumber(extractSeriesValue(bbL))}`
          );
        }
        if (kcUpperSeries && kcLowerSeries) {
          lines.push(
            `KC U/L: ${formatMaybeNumber(extractSeriesValue(kcU))} / ${formatMaybeNumber(extractSeriesValue(kcL))}`
          );
        }
        if (volumeSeries) {
          lines.push(`Vol: ${formatMaybeNumber(extractSeriesValue(vol))}`);
        }

        tooltip.textContent = lines.join("\n");
        tooltip.style.opacity = "1";
      });

      cleanup = () => {
        if (didCleanup) {
          return;
        }
        didCleanup = true;

        watermarkPlugin?.detach();
        squeezeMarkerPlugin?.detach();
        if (cloudAnchorSeries) {
          if (bbCloud) {
            cloudAnchorSeries.detachPrimitive(bbCloud);
          }
          if (kcCloud) {
            cloudAnchorSeries.detachPrimitive(kcCloud);
          }
          chart.removeSeries(cloudAnchorSeries);
        }
        chart.remove();
      };
    }

    void run();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [mounted, series, trade, isBuy, squeezeMarkers]);

  if (!mounted) {
    return (
      <section>
        {props.title ? <h4 className="report-h4">{props.title}</h4> : null}
        {props.showSignals ? (
          <p className="report-muted">
            <strong>Signals:</strong> {active.length > 0 ? active.join("; ") : "none"}
          </p>
        ) : null}

        <div
          style={{
            width: "100%",
            height: 420,
            borderRadius: 12,
            border: "1px solid var(--rp-border)",
            background: "var(--rp-surface)",
            overflow: "hidden"
          }}
        />
      </section>
    );
  }

  return (
    <section>
      {props.title ? <h4 className="report-h4">{props.title}</h4> : null}

      {props.showSignals ? (
        <p className="report-muted">
          <strong>Signals:</strong> {active.length > 0 ? active.join("; ") : "none"}
        </p>
      ) : null}

      <div
        ref={wrapperRef}
        style={{
          position: "relative",
          width: "100%",
          height: 420,
          borderRadius: 12,
          border: "1px solid var(--rp-border)",
          background: "var(--rp-surface)",
          overflow: "hidden"
        }}
      >
        <div ref={chartRef} style={{ position: "absolute", inset: 0 }} />
        <div ref={tooltipRef} style={{ position: "absolute", top: 10, left: 10 }} />
      </div>
    </section>
  );
}
