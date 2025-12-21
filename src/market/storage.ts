import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AnalyzedSeries, MarketInterval, MarketReport, RawSeries } from "./types";

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
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.endsWith(".mdx"))
    .map((e) => e.replace(/\.mdx$/, ""))
    .sort();
}

export async function writeRawSeries(date: string, series: RawSeries): Promise<void> {
  await writeJson(getRawSeriesPath(date, series.symbol, series.interval), series);
}

export async function writeAnalyzedSeries(date: string, series: AnalyzedSeries): Promise<void> {
  await writeJson(getAnalyzedSeriesPath(date, series.symbol, series.interval), series);
}

export async function writeReport(date: string, report: MarketReport, mdx: string): Promise<void> {
  await writeJson(getReportJsonPath(date), report);
  await writeFile(getReportMdxPath(date), mdx, "utf8");
}
