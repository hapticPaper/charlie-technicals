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
import { MARKET_INTERVALS, type MarketInterval, type MarketReport, type MarketReportSummaryWidgets } from "../../../market/types";

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
  try {
    const res = await renderMdx(mdxRaw, {
      ReportSummary: () => <ReportSummary summaryWidgets={summaryWidgets} />,
      ReportCharts: (props: { symbol?: unknown; interval?: unknown }) => {
        const symbol = typeof props.symbol === "string" ? props.symbol : null;
        const interval = typeof props.interval === "string" ? props.interval : null;

        if (!symbol || !interval || !(MARKET_INTERVALS as readonly string[]).includes(interval)) {
          console.error("[reports] ReportCharts rendered with invalid props", props);
          return <p>Unable to render chart (invalid chart spec).</p>;
        }

        return (
          <ReportCharts
            symbol={symbol}
            interval={interval as MarketInterval}
            series={report.series[symbol]?.[interval as MarketInterval]}
            trade={report.picks.find((p) => p.symbol === symbol)?.trade}
            isMissingSymbol={report.missingSymbols.includes(symbol)}
          />
        );
      },
      ReportPick: (props: { symbol?: unknown }) => {
        const symbol = typeof props.symbol === "string" ? props.symbol : null;
        if (!symbol) {
          console.error("[reports] ReportPick rendered with invalid props", props);
          return <p>Unable to render setup (invalid symbol).</p>;
        }

        const pick = report.picks.find((p) => p.symbol === symbol);
        const watch = report.watchlist?.find((p) => p.symbol === symbol);
        const setup = pick ?? watch;
        const setupType = pick && watch ? "both" : pick ? "pick" : watch ? "watchlist" : undefined;

        return (
          <ReportPick
            symbol={symbol}
            setup={setup}
            setupType={setupType}
            series1d={report.series[symbol]?.["1d"]}
            series15m={report.series[symbol]?.["15m"]}
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
