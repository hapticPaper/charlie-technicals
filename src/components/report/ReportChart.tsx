"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { IRange, LineData, SeriesMarker, Time, UTCTimestamp, WhitespaceData } from "lightweight-charts";

import type { ReportIntervalSeries, TradePlan } from "../../market/types";

type ChartAnnotations = {
  trade?: TradePlan;
};

function formatChartTime(time: Time | undefined): string {
  if (!time) {
    return "";
  }

  if (typeof time === "number") {
    const millis = time * 1000;
    if (!Number.isFinite(millis)) {
      return "";
    }

    const dt = new Date(millis);
    return dt.toLocaleString(undefined, {
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

    return dt.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
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
  point: LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp> | undefined
): number | undefined {
  if (!point) {
    return undefined;
  }

  if ("value" in point) {
    return point.value;
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

function toUtcTimestamp(t: number): UTCTimestamp | null {
  if (!Number.isFinite(t)) {
    return null;
  }

  const seconds = t > 10_000_000_000 ? t / 1000 : t;
  return Math.floor(seconds) as UTCTimestamp;
}

function toLineSeriesData(t: number[], values: Array<number | null>): Array<LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> {
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

  const priceWrapperRef = useRef<HTMLDivElement | null>(null);
  const priceChartRef = useRef<HTMLDivElement | null>(null);
  const priceTooltipRef = useRef<HTMLDivElement | null>(null);

  const rsiWrapperRef = useRef<HTMLDivElement | null>(null);
  const rsiChartRef = useRef<HTMLDivElement | null>(null);
  const rsiTooltipRef = useRef<HTMLDivElement | null>(null);

  const squeezeMarkers = useMemo(() => buildSqueezeMarkers(series), [series]);

  const active = series.signals.filter((s) => s.active).map((s) => s.label);
  const trade = annotations?.trade;
  const isBuy = trade?.side === "buy";
  const legendItems = ["Price", "SMA 20", "EMA 20"];
  if (series.bollinger20) {
    legendItems.push("Bollinger Bands (20)");
  }
  if (series.keltner20) {
    legendItems.push("Keltner Channels (20)");
  }
  if (squeezeMarkers.length > 0) {
    legendItems.push("TTM Squeeze markers");
  }

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const priceWrapper = priceWrapperRef.current;
    const priceChartEl = priceChartRef.current;
    const priceTooltip = priceTooltipRef.current;

    const rsiWrapper = rsiWrapperRef.current;
    const rsiChartEl = rsiChartRef.current;
    const rsiTooltip = rsiTooltipRef.current;

    if (!priceWrapper || !priceChartEl || !rsiWrapper || !rsiChartEl) {
      return;
    }

    const priceChartElement = priceChartEl;
    const rsiChartElement = rsiChartEl;

    let disposed = false;
    let cleanup = () => {};

    async function run() {
      const { createChart, createSeriesMarkers, ColorType, CrosshairMode, LineSeries, LineStyle } = await import(
        "lightweight-charts"
      );
      if (disposed) {
        return;
      }

      const surface = readCssVar("--rp-surface", "rgba(255, 255, 255, 0.06)");
      const border = readCssVar("--rp-border", "rgba(255, 255, 255, 0.12)");
      const grid = readCssVar("--rp-grid", "rgba(255, 255, 255, 0.08)");
      const text = readCssVar("--rp-text", "#e5e7eb");
      const muted = readCssVar("--rp-muted", "#a1a1aa");

      const priceColor = readCssVar("--rp-price", "#e5e7eb");
      const smaColor = readCssVar("--rp-sma", "#38bdf8");
      const emaColor = readCssVar("--rp-ema", "#a78bfa");
      const rsiColor = readCssVar("--rp-rsi", "#34d399");
      const bollingerColor = readCssVar("--rp-bollinger", "#60a5fa");
      const keltnerColor = readCssVar("--rp-keltner", "#f472b6");
      const bull = readCssVar("--rp-bull", "#22c55e");
      const bear = readCssVar("--rp-bear", "#fb7185");
      const warn = readCssVar("--rp-warn", "#f59e0b");
      const target = readCssVar("--rp-target", "#38bdf8");

      const sharedOptions = {
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
          textColor: muted
        },
        timeScale: {
          borderColor: border,
          timeVisible: true,
          secondsVisible: false
        },
        crosshair: {
          mode: CrosshairMode.Magnet
        }
      };

      const priceChart = createChart(priceChartElement, sharedOptions);
      const rsiChart = createChart(rsiChartElement, sharedOptions);

      const closeSeries = priceChart.addSeries(LineSeries, {
        color: priceColor,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false
      });
      const smaSeries = priceChart.addSeries(LineSeries, {
        color: smaColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false
      });
      const emaSeries = priceChart.addSeries(LineSeries, {
        color: emaColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false
      });

      const bbUpperSeries = series.bollinger20
        ? priceChart.addSeries(LineSeries, {
            color: bollingerColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false
          })
        : null;
      const bbLowerSeries = series.bollinger20
        ? priceChart.addSeries(LineSeries, {
            color: bollingerColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false
          })
        : null;
      const kcUpperSeries = series.keltner20
        ? priceChart.addSeries(LineSeries, {
            color: keltnerColor,
            lineWidth: 1,
            lineStyle: LineStyle.SparseDotted,
            priceLineVisible: false,
            lastValueVisible: false
          })
        : null;
      const kcLowerSeries = series.keltner20
        ? priceChart.addSeries(LineSeries, {
            color: keltnerColor,
            lineWidth: 1,
            lineStyle: LineStyle.SparseDotted,
            priceLineVisible: false,
            lastValueVisible: false
          })
        : null;

      closeSeries.setData(toLineSeriesData(series.t, series.close));
      smaSeries.setData(toLineSeriesData(series.t, series.sma20));
      emaSeries.setData(toLineSeriesData(series.t, series.ema20));
      bbUpperSeries?.setData(toLineSeriesData(series.t, series.bollinger20?.upper ?? []));
      bbLowerSeries?.setData(toLineSeriesData(series.t, series.bollinger20?.lower ?? []));
      kcUpperSeries?.setData(toLineSeriesData(series.t, series.keltner20?.upper ?? []));
      kcLowerSeries?.setData(toLineSeriesData(series.t, series.keltner20?.lower ?? []));

      const squeezeMarkerPlugin =
        squeezeMarkers.length > 0
          ? createSeriesMarkers(closeSeries, squeezeMarkers, { autoScale: false, zOrder: "aboveSeries" })
          : null;

      if (trade) {
        closeSeries.createPriceLine({
          price: trade.entry,
          color: isBuy ? bull : bear,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: `Entry ${trade.entry.toFixed(2)}`
        });
        closeSeries.createPriceLine({
          price: trade.stop,
          color: warn,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: `Stop ${trade.stop.toFixed(2)}`
        });
        trade.targets?.forEach((t, idx) => {
          closeSeries.createPriceLine({
            price: t,
            color: target,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            title: `T${idx + 1} ${t.toFixed(2)}`
          });
        });
      }

      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: rsiColor,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } })
      });
      rsiSeries.setData(toLineSeriesData(series.t, series.rsi14));
      rsiSeries.createPriceLine({ price: 70, color: border, lineStyle: LineStyle.Dotted, lineWidth: 1, title: "70" });
      rsiSeries.createPriceLine({ price: 30, color: border, lineStyle: LineStyle.Dotted, lineWidth: 1, title: "30" });

      priceChart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();

      const syncing = { value: false };
      const syncPriceToRsi = (range: IRange<Time> | null) => {
        if (!range) {
          return;
        }
        if (syncing.value) {
          return;
        }
        syncing.value = true;
        try {
          rsiChart.timeScale().setVisibleRange(range);
        } finally {
          syncing.value = false;
        }
      };
      const syncRsiToPrice = (range: IRange<Time> | null) => {
        if (!range) {
          return;
        }
        if (syncing.value) {
          return;
        }
        syncing.value = true;
        try {
          priceChart.timeScale().setVisibleRange(range);
        } finally {
          syncing.value = false;
        }
      };

      priceChart.timeScale().subscribeVisibleTimeRangeChange(syncPriceToRsi);
      rsiChart.timeScale().subscribeVisibleTimeRangeChange(syncRsiToPrice);

      if (priceTooltip) {
        priceTooltip.style.whiteSpace = "pre";
        priceTooltip.style.color = text;
        priceTooltip.style.pointerEvents = "none";
        priceTooltip.style.background = surface;
        priceTooltip.style.border = `1px solid ${border}`;
        priceTooltip.style.borderRadius = "10px";
        priceTooltip.style.padding = "8px 10px";
        priceTooltip.style.fontSize = "12px";
        priceTooltip.style.opacity = "0";
      }

      if (rsiTooltip) {
        rsiTooltip.style.whiteSpace = "pre";
        rsiTooltip.style.color = text;
        rsiTooltip.style.pointerEvents = "none";
        rsiTooltip.style.background = surface;
        rsiTooltip.style.border = `1px solid ${border}`;
        rsiTooltip.style.borderRadius = "10px";
        rsiTooltip.style.padding = "8px 10px";
        rsiTooltip.style.fontSize = "12px";
        rsiTooltip.style.opacity = "0";
      }

      priceChart.subscribeCrosshairMove((param) => {
        if (!priceTooltip) {
          return;
        }

        const timeLabel = formatChartTime(param.time);
        if (!param.point || !timeLabel) {
          priceTooltip.style.opacity = "0";
          return;
        }

        const close = param.seriesData.get(closeSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined;
        const sma = param.seriesData.get(smaSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined;
        const ema = param.seriesData.get(emaSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined;
        const bbU = bbUpperSeries
          ? (param.seriesData.get(bbUpperSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined)
          : undefined;
        const bbL = bbLowerSeries
          ? (param.seriesData.get(bbLowerSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined)
          : undefined;
        const kcU = kcUpperSeries
          ? (param.seriesData.get(kcUpperSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined)
          : undefined;
        const kcL = kcLowerSeries
          ? (param.seriesData.get(kcLowerSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined)
          : undefined;

        const lines = [
          timeLabel,
          `Close: ${formatMaybeNumber(extractSeriesValue(close))}`,
          `SMA 20: ${formatMaybeNumber(extractSeriesValue(sma))}`,
          `EMA 20: ${formatMaybeNumber(extractSeriesValue(ema))}`
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

        priceTooltip.textContent = lines.join("\n");
        priceTooltip.style.opacity = "1";
      });

      rsiChart.subscribeCrosshairMove((param) => {
        if (!rsiTooltip) {
          return;
        }

        const timeLabel = formatChartTime(param.time);
        if (!param.point || !timeLabel) {
          rsiTooltip.style.opacity = "0";
          return;
        }

        const rsiValue = param.seriesData.get(rsiSeries) as (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>) | undefined;
        const lines = [
          timeLabel,
          `RSI 14: ${formatMaybeNumber(extractSeriesValue(rsiValue))}`
        ];

        rsiTooltip.textContent = lines.join("\n");
        rsiTooltip.style.opacity = "1";
      });

      cleanup = () => {
        squeezeMarkerPlugin?.detach();
        priceChart.timeScale().unsubscribeVisibleTimeRangeChange(syncPriceToRsi);
        rsiChart.timeScale().unsubscribeVisibleTimeRangeChange(syncRsiToPrice);
        priceChart.remove();
        rsiChart.remove();
      };
    }

    void run();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [mounted, series, trade, isBuy]);

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
            height: 260,
            borderRadius: 12,
            border: "1px solid var(--rp-border)",
            background: "var(--rp-surface)",
            overflow: "hidden"
          }}
        />
        <div
          style={{
            width: "100%",
            height: 200,
            marginTop: 12,
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
        ref={priceWrapperRef}
        style={{
          position: "relative",
          width: "100%",
          height: 260,
          borderRadius: 12,
          border: "1px solid var(--rp-border)",
          background: "var(--rp-surface)",
          overflow: "hidden"
        }}
      >
        <div ref={priceChartRef} style={{ position: "absolute", inset: 0 }} />
        <div ref={priceTooltipRef} style={{ position: "absolute", top: 10, left: 10 }} />
      </div>

      <p className="report-muted" style={{ margin: "8px 0 0" }}>
        <strong>Legend:</strong> {legendItems.join(" / ")}
      </p>

      <div
        ref={rsiWrapperRef}
        style={{
          position: "relative",
          width: "100%",
          height: 200,
          marginTop: 12,
          borderRadius: 12,
          border: "1px solid var(--rp-border)",
          background: "var(--rp-surface)",
          overflow: "hidden"
        }}
      >
        <div ref={rsiChartRef} style={{ position: "absolute", inset: 0 }} />
        <div ref={rsiTooltipRef} style={{ position: "absolute", top: 10, left: 10 }} />
      </div>
    </section>
  );
}
