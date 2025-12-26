import { readFile } from "node:fs/promises";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ReportCharts } from "../../../components/report/ReportCharts";
import { CnbcVideoWidget } from "../../../components/report/CnbcVideoWidget";
import { ReportPick } from "../../../components/report/ReportPick";
import { ReportProvider } from "../../../components/report/ReportProvider";
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
import type { MarketReport, MarketReportSummaryWidgets } from "../../../market/types";

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
    const res = await renderMdx(mdxRaw, { ReportSummary, ReportCharts, ReportPick, CnbcVideoWidget });
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
    <ReportProvider report={report} summaryWidgets={summaryWidgets}>
      <>
        <h1>{title}</h1>
        {content}
      </>
    </ReportProvider>
  );
}
