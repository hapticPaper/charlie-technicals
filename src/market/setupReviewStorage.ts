import { readdir, rm } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { formatRawDataFileDate } from "./dataConventions";
import { fileExists } from "./fsUtils";
import { getContentDir, readJson, writeJson } from "./storage";
import type { SetupReviewPerformance } from "./types";

function safeSymbol(symbol: string): string {
  return encodeURIComponent(symbol);
}

export function getSetupReviewsDir(): string {
  return path.join(getContentDir(), "setup_reviews");
}

function getSetupReviewDateDir(setupDate: string): string {
  const fileDate = formatRawDataFileDate(setupDate);
  return path.join(getSetupReviewsDir(), fileDate);
}

export function getSetupReviewSymbolDir(setupDate: string, symbol: string): string {
  return path.join(getSetupReviewDateDir(setupDate), safeSymbol(symbol));
}

export function getSetupReviewOpenPerformancePath(setupDate: string, symbol: string): string {
  return path.join(getSetupReviewSymbolDir(setupDate, symbol), "open_performance.json");
}

export function getSetupReviewClosedPerformancePath(setupDate: string, symbol: string): string {
  return path.join(getSetupReviewSymbolDir(setupDate, symbol), "closed_performance.json");
}

export function getSetupReviewMdxPath(setupDate: string): string {
  return path.join(getSetupReviewsDir(), `${setupDate}.mdx`);
}

export async function readSetupReviewPerformance(
  setupDate: string,
  symbol: string
): Promise<SetupReviewPerformance | null> {
  const closedPath = getSetupReviewClosedPerformancePath(setupDate, symbol);
  if (await fileExists(closedPath)) {
    return readJson<SetupReviewPerformance>(closedPath);
  }

  const openPath = getSetupReviewOpenPerformancePath(setupDate, symbol);
  if (await fileExists(openPath)) {
    return readJson<SetupReviewPerformance>(openPath);
  }

  return null;
}

export async function writeSetupReviewPerformance(perf: SetupReviewPerformance): Promise<void> {
  const openPath = getSetupReviewOpenPerformancePath(perf.setupDate, perf.symbol);
  const closedPath = getSetupReviewClosedPerformancePath(perf.setupDate, perf.symbol);

  if (perf.status === "closed") {
    await writeJson(closedPath, perf, { pretty: true });
    await rm(openPath, { force: true });
    return;
  }

  await writeJson(openPath, perf, { pretty: true });
  await rm(closedPath, { force: true });
}

export type SetupReviewListedPerformance = {
  dateDir: string;
  fileKind: "open" | "closed";
  performance: SetupReviewPerformance;
};

export async function listSetupReviewPerformancesForDate(setupDate: string): Promise<SetupReviewListedPerformance[]> {
  const rootDir = getSetupReviewDateDir(setupDate);
  const dateDir = path.basename(rootDir);

  let symbolEntries: Dirent[] = [];
  try {
    symbolEntries = await readdir(rootDir, { withFileTypes: true });
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

  const out: SetupReviewListedPerformance[] = [];
  const symbols = symbolEntries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const encodedSymbol of symbols) {
    const symbolDir = path.join(rootDir, encodedSymbol);
    const openPath = path.join(symbolDir, "open_performance.json");
    const closedPath = path.join(symbolDir, "closed_performance.json");

    if (await fileExists(closedPath)) {
      out.push({
        dateDir,
        fileKind: "closed",
        performance: await readJson<SetupReviewPerformance>(closedPath)
      });
      continue;
    }

    if (await fileExists(openPath)) {
      out.push({
        dateDir,
        fileKind: "open",
        performance: await readJson<SetupReviewPerformance>(openPath)
      });
    }
  }

  return out;
}

export async function listSetupReviewPerformances(): Promise<SetupReviewListedPerformance[]> {
  const root = getSetupReviewsDir();

  let dateEntries: Dirent[] = [];
  try {
    dateEntries = await readdir(root, { withFileTypes: true });
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

  const dateDirs = dateEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^\d{8}$/.test(name))
    .sort();

  const out: SetupReviewListedPerformance[] = [];

  for (const dateDir of dateDirs) {
    const dirPath = path.join(root, dateDir);
    let symbolEntries: Dirent[] = [];
    try {
      symbolEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const symbols = symbolEntries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const encodedSymbol of symbols) {
      const symbolDir = path.join(dirPath, encodedSymbol);
      const openPath = path.join(symbolDir, "open_performance.json");
      const closedPath = path.join(symbolDir, "closed_performance.json");

      if (await fileExists(closedPath)) {
        out.push({
          dateDir,
          fileKind: "closed",
          performance: await readJson<SetupReviewPerformance>(closedPath)
        });
        continue;
      }

      if (await fileExists(openPath)) {
        out.push({
          dateDir,
          fileKind: "open",
          performance: await readJson<SetupReviewPerformance>(openPath)
        });
      }
    }
  }

  return out;
}
