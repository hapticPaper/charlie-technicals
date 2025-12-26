"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import type { MarketReport, MarketReportSummaryWidgets } from "../../market/types";

type ReportContextValue = {
  report: MarketReport;
  summaryWidgets: MarketReportSummaryWidgets;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider(props: {
  report: MarketReport;
  summaryWidgets: MarketReportSummaryWidgets;
  children: ReactNode;
}) {
  return (
    <ReportContext.Provider value={{ report: props.report, summaryWidgets: props.summaryWidgets }}>
      {props.children}
    </ReportContext.Provider>
  );
}

export function useReport(): MarketReport {
  const ctx = useContext(ReportContext);
  if (!ctx) {
    throw new Error("ReportProvider context is missing. Wrap the MDX render tree in <ReportProvider>.");
  }
  return ctx.report;
}

export function useReportSummaryWidgets(): MarketReportSummaryWidgets {
  const ctx = useContext(ReportContext);
  if (!ctx) {
    throw new Error(
      "ReportProvider context is missing. Wrap report components in <ReportProvider> and supply summaryWidgets."
    );
  }
  return ctx.summaryWidgets;
}
