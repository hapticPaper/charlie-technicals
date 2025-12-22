import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Dirent } from "node:fs";

import type { AnalyzedSeries, MarketAnalysisSummary, MarketInterval, MarketReport, RawSeries } from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");

function safeSymbol(symbol: string): string {
  return encodeURIComponent(symbol);
}

export function getContentDir(): string {
  return CONTENT_DIR;
}

export function getDataDir(date: string): string {
  return path.join(CONTENT_DIR, "data", date);
}

export function getAnalysisDir(date: string): string {
  return path.join(CONTENT_DIR, "analysis", date);
}

export function getReportsDir(): string {
  return path.join(CONTENT_DIR, "reports");
}

export function getAnalysisSummaryJsonPath(date: string): string {
  return path.join(getAnalysisDir(date), "summary.json");
}

export function getAnalysisMdxPath(date: string): string {
  return path.join(getAnalysisDir(date), "index.mdx");
}

export function getRawSeriesPath(date: string, symbol: string, interval: MarketInterval): string {
  return path.join(getDataDir(date), `${safeSymbol(symbol)}.${interval}.json`);
}

export function getAnalyzedSeriesPath(date: string, symbol: string, interval: MarketInterval): string {
  return path.join(getAnalysisDir(date), `${safeSymbol(symbol)}.${interval}.json`);
}

export function getReportJsonPath(date: string): string {
  return path.join(getReportsDir(), `${date}.json`);
}

export function getReportMdxPath(date: string): string {
  return path.join(getReportsDir(), `${date}.mdx`);
}

export async function ensureDirs(date: string): Promise<void> {
  await mkdir(getDataDir(date), { recursive: true });
  await mkdir(getAnalysisDir(date), { recursive: true });
  await mkdir(getReportsDir(), { recursive: true });
}

export async function writeJson(
  filePath: string,
  value: unknown,
  opts: {
    pretty?: boolean;
  } = {}
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const json = opts.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  await writeFile(filePath, `${json}\n`, "utf8");
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function listReportDates(): Promise<string[]> {
  const dir = getReportsDir();
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return entries
    .filter((e) => e.endsWith(".mdx"))
    .map((e) => e.replace(/\.mdx$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

export async function listAnalysisDates(): Promise<string[]> {
  const dir = path.join(CONTENT_DIR, "analysis");
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const dates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const name = entry.name;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) {
      continue;
    }

    try {
      const files = await readdir(getAnalysisDir(name));
      if (files.includes("index.mdx") && files.includes("summary.json")) {
        dates.push(name);
      }
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;

      if (code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  return dates.sort();
}

export async function writeRawSeries(date: string, series: RawSeries): Promise<void> {
  await writeJson(getRawSeriesPath(date, series.symbol, series.interval), series);
}

export async function writeAnalyzedSeries(date: string, series: AnalyzedSeries): Promise<void> {
  await writeJson(getAnalyzedSeriesPath(date, series.symbol, series.interval), series);
}

export async function writeReport(date: string, report: MarketReport, mdx: string): Promise<void> {
  const jsonPath = getReportJsonPath(date);
  const mdxPath = getReportMdxPath(date);
  const jsonTmp = `${jsonPath}.tmp`;
  const mdxTmp = `${mdxPath}.tmp`;

  await writeJson(jsonTmp, report);
  await writeFile(mdxTmp, mdx, "utf8");

  await rename(jsonTmp, jsonPath);
  await rename(mdxTmp, mdxPath);
}

export async function writeAnalysisPage(date: string, summary: MarketAnalysisSummary, mdx: string): Promise<void> {
  const jsonPath = getAnalysisSummaryJsonPath(date);
  const mdxPath = getAnalysisMdxPath(date);
  const jsonTmp = `${jsonPath}.tmp`;
  const mdxTmp = `${mdxPath}.tmp`;

  await writeJson(jsonTmp, summary);
  await writeFile(mdxTmp, mdx, "utf8");

  await rename(jsonTmp, jsonPath);
  await rename(mdxTmp, mdxPath);
}
