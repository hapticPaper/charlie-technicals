import { readFile } from "node:fs/promises";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AnalysisSeries } from "../../../components/analysis/AnalysisSeries";
import { AnalysisProvider } from "../../../components/analysis/AnalysisProvider";
import { AnalysisSummary } from "../../../components/analysis/AnalysisSummary";
import { renderMdx } from "../../../lib/mdx";
import {
  getAnalysisMdxPath,
  getAnalysisSummaryJsonPath,
  listAnalysisDates,
  readJson
} from "../../../market/storage";
import type { MarketAnalysisSummary } from "../../../market/types";

function getAnalysisTitle(date: string): string {
  return `Market Analysis: ${date}`;
}

function isEnoent(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  return code === "ENOENT";
}

export async function generateStaticParams() {
  const dates = await listAnalysisDates();
  return dates.map((date) => ({ date }));
}

export async function generateMetadata(props: { params: { date: string } }): Promise<Metadata> {
  const { date } = await Promise.resolve(props.params);
  return { title: getAnalysisTitle(date) };
}

export default async function AnalysisPage(props: { params: { date: string } }) {
  const { date } = await Promise.resolve(props.params);

  let analysis: MarketAnalysisSummary | undefined;
  try {
    analysis = await readJson<MarketAnalysisSummary>(getAnalysisSummaryJsonPath(date));
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }

  let mdxRaw: string | undefined;
  try {
    mdxRaw = await readFile(getAnalysisMdxPath(date), "utf8");
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }

  if (!analysis && !mdxRaw) {
    notFound();
  }

  if (!analysis) {
    throw new Error(`Missing analysis summary.json for ${date}.`);
  }

  if (!mdxRaw) {
    throw new Error(`Missing analysis index.mdx for ${date}.`);
  }

  let content: ReactNode;
  try {
    const res = await renderMdx(mdxRaw, { AnalysisSummary, AnalysisSeries });
    content = res.content;
  } catch (error) {
    try {
      if (error && typeof error === "object") {
        (error as { analysisDate?: string }).analysisDate = date;
      }
    } catch {
      // Ignore if we can't mutate the thrown value.
    }

    throw error;
  }

  const title = getAnalysisTitle(date);

  return (
    <AnalysisProvider analysis={analysis}>
      <>
        <h1>{title}</h1>
        {content}
      </>
    </AnalysisProvider>
  );
}
