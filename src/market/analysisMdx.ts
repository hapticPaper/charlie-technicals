import type { MarketAnalysisSummary } from "./types";

export function buildAnalysisMdx(summary: MarketAnalysisSummary): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: Market Analysis: ${summary.date}`);
  lines.push(`date: ${summary.date}`);
  lines.push(`generatedAt: ${summary.generatedAt}`);
  lines.push("---");
  lines.push("");
  lines.push("<AnalysisSummary />");
  lines.push("");
  lines.push("## Universe");
  lines.push("");
  lines.push(`Symbols: ${summary.symbols.join(", ")}`);
  lines.push("");
  lines.push(`Intervals: ${summary.intervals.join(", ")}`);
  lines.push("");

  if (summary.missingSymbols.length > 0) {
    lines.push(`Missing symbols: ${summary.missingSymbols.join(", ")}`);
    lines.push("");
  }

  for (const symbol of summary.symbols) {
    lines.push(`## ${symbol}`);
    lines.push("");

    for (const interval of summary.intervals) {
      lines.push(`### ${interval}`);
      lines.push("");
      lines.push(`<AnalysisSeries symbol="${symbol}" interval="${interval}" />`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}
