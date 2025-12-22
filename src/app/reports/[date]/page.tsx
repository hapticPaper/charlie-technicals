import { readFile } from "node:fs/promises";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ReportCharts } from "../../../components/report/ReportCharts";
import { ReportProvider } from "../../../components/report/ReportProvider";
import { ReportSummary } from "../../../components/report/ReportSummary";
import { isEnoent } from "../../../lib/fsErrors";
import { renderMdx } from "../../../lib/mdx";
import { getReportJsonPath, getReportMdxPath, listReportDates, readJson } from "../../../market/storage";
import type { MarketReport } from "../../../market/types";

function getReportTitle(date: string): string {
  return `Market Report: ${date}`;
}

export async function generateStaticParams() {
  const dates = await listReportDates();
  return dates.map((date) => ({ date }));
}

export async function generateMetadata(props: { params: { date: string } }): Promise<Metadata> {
  const { date } = await Promise.resolve(props.params);

  return { title: getReportTitle(date) };
}

export default async function ReportPage(props: { params: { date: string } }) {
  const { date } = await Promise.resolve(props.params);

  const [report, mdxRaw] = await Promise.all([
    (async () => {
      try {
        return await readJson<MarketReport>(getReportJsonPath(date));
      } catch (error) {
        if (!isEnoent(error)) {
          throw error;
        }
        return undefined;
      }
    })(),
    (async () => {
      try {
        return await readFile(getReportMdxPath(date), "utf8");
      } catch (error) {
        if (!isEnoent(error)) {
          throw error;
        }
        return undefined;
      }
    })()
  ]);

  if (!report && !mdxRaw) {
    notFound();
  }

  if (!report) {
    throw new Error(`Missing report JSON for ${date}.`);
  }

  if (!mdxRaw) {
    throw new Error(`Missing report MDX for ${date}.`);
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
