"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import type { MarketReport } from "../../market/types";

const ReportContext = createContext<MarketReport | null>(null);

export function ReportProvider(props: { report: MarketReport; children: ReactNode }) {
  return <ReportContext.Provider value={props.report}>{props.children}</ReportContext.Provider>;
}

export function useReport(): MarketReport {
  const report = useContext(ReportContext);
  if (!report) {
    throw new Error("ReportProvider context is missing. Wrap the MDX render tree in <ReportProvider>.");
  }
  return report;
}
