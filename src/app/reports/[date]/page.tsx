import { readFile } from "node:fs/promises";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ReportCharts } from "../../../components/report/ReportCharts";
import { CnbcVideoWidget } from "../../../components/report/CnbcVideoWidget";
import { ReportPick } from "../../../components/report/ReportPick";
import { ReportSummary } from "../../../components/report/ReportSummary";
import { renderMdx } from "../../../lib/mdx";
import { parseIsoDateYmd } from "../../../market/date";
import {
  buildReportSummaryWidgets,
  isMarketReportSummaryWidgets
} from "../../../market/summaryWidgets";
import {
  getReportJsonPath,
  getReportMdxPath,
  getReportSummaryWidgetsJsonPath,
  listReportDates,
  readJson
} from "../../../market/reportStorage";
import {
  MARKET_INTERVALS,
  type MarketInterval,
  type MarketReport,
  type MarketReportSummaryWidgets,
  type ReportIntervalSeries,
  type SetupReviewPerformance
} from "../../../market/types";
import { readSetupReviewPerformance } from "../../../market/setupReviewStorage";

const MARKET_INTERVAL_SET: ReadonlySet<string> = new Set(MARKET_INTERVALS);

function isMarketInterval(value: unknown): value is MarketInterval {
  return typeof value === "string" && MARKET_INTERVAL_SET.has(value);
}

// Log-only details for report MDX wiring issues.
//
// Notes:
// - Best-effort diagnostics: every field is optional.
// - Development logs may include all fields; production logs use a minimal, non-sensitive subset.
type ReportMdxIssueDetails = {
  component?: string;
  symbol?: string;
  interval?: string;
  symbolType?: string;
  intervalType?: string;
  invalidInterval?: string;
  hasPick?: boolean;
  hasWatch?: boolean;
  missingSeries?: string;
};

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function logReportMdxIssue(date: string, message: string, details?: ReportMdxIssueDetails) {
  const safeDetails = details ? omitUndefined(details) : undefined;
  const payload = safeDetails ? { date, ...safeDetails } : { date };

  if (process.env.NODE_ENV !== "production") {
    console.error(`[reports] ${message}`, payload);
    return;
  }

  const prodDetails = safeDetails
    ? {
        component: safeDetails.component,
        symbol: safeDetails.symbol,
        interval: safeDetails.interval,
        invalidInterval: safeDetails.invalidInterval,
        missingSeries: safeDetails.missingSeries
      }
    : undefined;
  const prodPayload = prodDetails ? omitUndefined({ date, ...prodDetails }) : { date };

  console.warn(`[reports] ${message}`, prodPayload);
}

type ReportPageParams = { date: string };
type ReportPageProps = { params: ReportPageParams | PromiseLike<ReportPageParams> };

async function resolveAndValidateParams(params: ReportPageProps["params"]): Promise<ReportPageParams> {
  // Next (Turbopack) may pass `params` as a thenable during prerendering.
  const resolved = await params;

  const date = (resolved as { date?: unknown })?.date;
  if (typeof date !== "string") {
    notFound();
  }

  try {
    parseIsoDateYmd(date);
  } catch {
    notFound();
  }

  return { date };
}

function getReportTitle(date: string): string {
  return `Market Report: ${date}`;
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === "string") {
      return code;
    }
  }

  return undefined;
}

// Resolves the price series required for rendering a pick.
// Picks currently require both 1d and 15m series; if either is missing we treat the symbol as
// not renderable in the MDX layer.
function resolvePickSeries(report: MarketReport, symbol: string):
  | { ok: true; series1d: ReportIntervalSeries; series15m: ReportIntervalSeries }
  | { ok: false; missingSeries: string } {
  const series1d = report.series[symbol]?.["1d"];
  const series15m = report.series[symbol]?.["15m"];

  const missing1d = series1d == null;
  const missing15m = series15m == null;

  if (missing1d || missing15m) {
    const missingSeries = missing1d && missing15m ? "1d+15m" : missing1d ? "1d" : "15m";
    return { ok: false, missingSeries };
  }

  return { ok: true, series1d, series15m };
}


export async function generateStaticParams() {
  const dates = await listReportDates();
  return dates.map((date) => ({ date }));
}

export async function generateMetadata(props: ReportPageProps): Promise<Metadata> {
  const { date } = await resolveAndValidateParams(props.params);

  return { title: getReportTitle(date) };
}

export default async function ReportPage(props: ReportPageProps) {
  const { date } = await resolveAndValidateParams(props.params);

  let report: MarketReport;
  let mdxRaw: string;
  try {
    report = await readJson<MarketReport>(getReportJsonPath(date));
    mdxRaw = await readFile(getReportMdxPath(date), "utf8");
  } catch (error) {
    const code = nodeErrorCode(error);

    if (code === "ENOENT") {
      notFound();
    }

    throw error;
  }

  const summaryWidgetsPath = getReportSummaryWidgetsJsonPath(date);
  let summaryWidgets: MarketReportSummaryWidgets;
  try {
    const candidate = await readJson<unknown>(summaryWidgetsPath);
    if (!isMarketReportSummaryWidgets(candidate)) {
      throw new Error(`Unexpected summary widgets schema (expected v1-summary-widgets): ${summaryWidgetsPath}`);
    }
    summaryWidgets = candidate;
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[reports] Summary widgets cache invalid or unreadable; rebuilding from report JSON: ${summaryWidgetsPath} (${date}): ${message}`
      );
    }

    summaryWidgets = buildReportSummaryWidgets(report);
  }

  let content: ReactNode;

  const setupSymbols = new Set<string>([
    ...report.picks.map((p) => p.symbol),
    ...(report.watchlist?.map((p) => p.symbol) ?? [])
  ]);
  const performanceEntries = await Promise.all(
    Array.from(setupSymbols).map(async (symbol) => ({
      symbol,
      performance: await readSetupReviewPerformance(date, symbol)
    }))
  );
  const performanceBySymbol = new Map<string, SetupReviewPerformance>();
  for (const entry of performanceEntries) {
    if (entry.performance) {
      performanceBySymbol.set(entry.symbol, entry.performance);
    }
  }

  try {
    const res = await renderMdx(mdxRaw, {
      ReportSummary: () => <ReportSummary summaryWidgets={summaryWidgets} />,
      ReportCharts: (props: { symbol?: unknown; interval?: unknown }) => {
        const rawSymbol = props.symbol;
        const rawInterval = props.interval;
        const symbol = typeof rawSymbol === "string" ? rawSymbol : null;
        const interval = isMarketInterval(rawInterval) ? rawInterval : null;

        if (!symbol || !interval) {
          logReportMdxIssue(date, "ReportCharts rendered with invalid symbol or interval", {
            component: "ReportCharts",
            symbol: typeof rawSymbol === "string" ? rawSymbol : undefined,
            interval: interval ?? undefined,
            symbolType: typeof rawSymbol,
            intervalType: typeof rawInterval,
            invalidInterval: typeof rawInterval === "string" && !isMarketInterval(rawInterval) ? rawInterval : undefined
          });
          return <p>Unable to render chart (invalid chart spec).</p>;
        }

        return (
          <ReportCharts
            symbol={symbol}
            interval={interval}
            series={report.series[symbol]?.[interval]}
            trade={report.picks.find((p) => p.symbol === symbol)?.trade}
            isMissingSymbol={report.missingSymbols.includes(symbol)}
          />
        );
      },
      ReportPick: (props: { symbol?: unknown }) => {
        const rawSymbol = props.symbol;
        const symbol = typeof rawSymbol === "string" ? rawSymbol : null;
        if (!symbol) {
          logReportMdxIssue(date, "ReportPick rendered with invalid props", {
            component: "ReportPick",
            symbol: typeof rawSymbol === "string" ? rawSymbol : undefined,
            symbolType: typeof rawSymbol
          });
          return <p>Unable to render setup (invalid symbol).</p>;
        }

        const pick = report.picks.find((p) => p.symbol === symbol);
        const watch = report.watchlist?.find((p) => p.symbol === symbol);
        const setup = pick ?? watch;
        const setupType = pick && watch ? "both" : pick ? "pick" : watch ? "watchlist" : undefined;

        if (!setup || !setupType) {
          logReportMdxIssue(date, "ReportPick missing setup data", {
            component: "ReportPick",
            symbol,
            hasPick: Boolean(pick),
            hasWatch: Boolean(watch)
          });
          return <p>Missing setup data for {symbol} (cannot render setup charts).</p>;
        }

        const series = resolvePickSeries(report, symbol);
        if (!series.ok) {
          logReportMdxIssue(date, "ReportPick missing series", {
            component: "ReportPick",
            symbol,
            hasPick: Boolean(pick),
            hasWatch: Boolean(watch),
            missingSeries: series.missingSeries
          });
          return <p>Missing price series data for {symbol} (cannot render report charts).</p>;
        }

        return (
          <ReportPick
            setup={setup}
            setupType={setupType}
            series1d={series.series1d}
            series15m={series.series15m}
            performance={performanceBySymbol.get(symbol) ?? null}
          />
        );
      },
      CnbcVideoWidget
    });
    content = res.content;
  } catch (error) {
    try {
      if (error && typeof error === "object") {
        (error as { reportDate?: string }).reportDate = date;
      }
    } catch {
      // Ignore if we can't mutate the thrown value.
    }

    throw error;
  }

  const title = getReportTitle(date);

  return (
    <>
      <h1>{title}</h1>
      {content}
    </>
  );
}
