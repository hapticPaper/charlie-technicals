import { readFile } from "node:fs/promises";

import matter from "gray-matter";
import { MDXRemote } from "next-mdx-remote/rsc";
import { notFound } from "next/navigation";

import { ReportCharts } from "../../../components/report/ReportCharts";
import { ReportProvider } from "../../../components/report/ReportProvider";
import { ReportSummary } from "../../../components/report/ReportSummary";
import { getReportJsonPath, getReportMdxPath, listReportDates, readJson } from "../../../market/storage";
import type { MarketReport } from "../../../market/types";

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
  } catch {
    notFound();
  }

  const { content } = matter(mdxRaw);

  return (
    <ReportProvider report={report}>
      <MDXRemote
        source={content}
        components={{
          ReportSummary,
          ReportCharts
        }}
      />
    </ReportProvider>
  );
}
