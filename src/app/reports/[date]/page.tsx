import { readFile } from "node:fs/promises";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ReportCharts } from "../../../components/report/ReportCharts";
import { ReportProvider } from "../../../components/report/ReportProvider";
import { ReportSummary } from "../../../components/report/ReportSummary";
import { renderMdx } from "../../../lib/mdx";
import { getReportJsonPath, getReportMdxPath, listReportDates, readJson } from "../../../market/storage";
import type { MarketReport } from "../../../market/types";

type ReportPageProps = { params: { date: string } };

function getReportTitle(date: string): string {
  return `Market Report: ${date}`;
}

export async function generateStaticParams() {
  const dates = await listReportDates();
  return dates.map((date) => ({ date }));
}

export async function generateMetadata(props: ReportPageProps): Promise<Metadata> {
  const { date } = await props.params;

  return { title: getReportTitle(date) };
}

export default async function ReportPage(props: ReportPageProps) {
  const { date } = await props.params;

  let report: MarketReport;
  let mdxRaw: string;
  try {
    report = await readJson<MarketReport>(getReportJsonPath(date));
    mdxRaw = await readFile(getReportMdxPath(date), "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === "ENOENT") {
      notFound();
    }

    throw error;
  }

  let content: ReactNode;
  try {
    const res = await renderMdx(mdxRaw, { ReportSummary, ReportCharts });
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
    <ReportProvider report={report}>
      <>
        <h1>{title}</h1>
        {content}
      </>
    </ReportProvider>
  );
}
