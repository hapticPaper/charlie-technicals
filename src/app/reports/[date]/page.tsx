import { readFile } from "node:fs/promises";

import { notFound } from "next/navigation";

import { ReportProvider } from "../../../components/report/ReportProvider";
import { renderMdx } from "../../../lib/mdx";
import { getReportJsonPath, getReportMdxPath, listReportDates, readJson } from "../../../market/storage";
import type { MarketReport } from "../../../market/types";

export const dynamicParams = false;

export async function generateStaticParams() {
  const dates = await listReportDates();
  return dates.map((date) => ({ date }));
}

export default async function ReportPage(props: { params: { date: string } }) {
  const { date } = props.params;

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

  const { content } = await renderMdx(mdxRaw);

  return (
    <ReportProvider report={report}>
      {content}
    </ReportProvider>
  );
}
