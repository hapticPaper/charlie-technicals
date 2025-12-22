import { readFile } from "node:fs/promises";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AnalysisSeries } from "../../../components/analysis/AnalysisSeries";
import { AnalysisProvider } from "../../../components/analysis/AnalysisProvider";
import { AnalysisSummary } from "../../../components/analysis/AnalysisSummary";
import { isEnoent } from "../../../lib/fsErrors";
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

  const [analysis, mdxRaw] = await Promise.all([
    (async () => {
      try {
        return await readJson<MarketAnalysisSummary>(getAnalysisSummaryJsonPath(date));
      } catch (error) {
        if (!isEnoent(error)) {
          throw error;
        }
        return undefined;
      }
    })(),
    (async () => {
      try {
        return await readFile(getAnalysisMdxPath(date), "utf8");
      } catch (error) {
        if (!isEnoent(error)) {
          throw error;
        }
        return undefined;
      }
    })()
  ]);

  if (!analysis || !mdxRaw) {
    notFound();
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
