"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import type { MarketAnalysisSummary } from "../../market/types";

const AnalysisContext = createContext<MarketAnalysisSummary | null>(null);

export function AnalysisProvider(props: { analysis: MarketAnalysisSummary; children: ReactNode }) {
  return <AnalysisContext.Provider value={props.analysis}>{props.children}</AnalysisContext.Provider>;
}

export function useAnalysis(): MarketAnalysisSummary {
  const analysis = useContext(AnalysisContext);
  if (!analysis) {
    throw new Error("AnalysisProvider context is missing. Wrap the MDX render tree in <AnalysisProvider>.");
  }
  return analysis;
}
