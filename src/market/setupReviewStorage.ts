import { readdir, rm } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { formatRawDataFileDate } from "./dataConventions";
import { fileExists } from "./fsUtils";
import { getContentDir, readJson, writeJson } from "./storage";
import { SETUP_REVIEW_PERFORMANCE_VERSION, type SetupReviewPerformance } from "./types";

function coerceSetupReviewPerformance(raw: unknown, filePath: string): SetupReviewPerformance | null {
  if (typeof raw !== "object" || raw === null) {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath });
    return null;
  }

  const perf = raw as Record<string, unknown>;
  const version = perf.version;
  if (typeof version !== "string") {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath });
    return null;
  }

  if (version !== SETUP_REVIEW_PERFORMANCE_VERSION) {
    // NOTE: we only accept the current SETUP_REVIEW_PERFORMANCE_VERSION. Older
    // versions are ignored and must be regenerated under the current semantics.
    console.warn("[setup-review] Unsupported setup review performance version", {
      kind: "unsupported_version",
      filePath,
      version
    });
    return null;
  }

  if (typeof perf.setupDate !== "string" || typeof perf.symbol !== "string") {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath, version });
    return null;
  }

  const trade = perf.trade;
  const entry =
    typeof trade === "object" && trade !== null && "entry" in trade ? (trade as { entry?: unknown }).entry : undefined;
  if (typeof entry !== "number") {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath, version });
    return null;
  }

  const status = perf.status;
  if (status !== "open" && status !== "closed") {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath, version });
    return null;
  }

  if (typeof perf.outcome !== "string") {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath, version });
    return null;
  }

  if (typeof perf.realizedPct !== "number") {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath, version });
    return null;
  }

  const totalPct = perf.totalPct;
  if (totalPct !== null && typeof totalPct !== "number") {
    console.warn("[setup-review] Malformed setup review performance payload", { kind: "malformed_payload", filePath, version });
    return null;
  }

  return raw as SetupReviewPerformance;
}

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
    const perf = await readJson<unknown>(closedPath);
    return coerceSetupReviewPerformance(perf, closedPath);
  }

  const openPath = getSetupReviewOpenPerformancePath(setupDate, symbol);
  if (await fileExists(openPath)) {
    const perf = await readJson<unknown>(openPath);
    return coerceSetupReviewPerformance(perf, openPath);
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
  let ignoredDueToVersion = 0;
  const symbols = symbolEntries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const encodedSymbol of symbols) {
    const symbolDir = path.join(rootDir, encodedSymbol);
    const openPath = path.join(symbolDir, "open_performance.json");
    const closedPath = path.join(symbolDir, "closed_performance.json");

    if (await fileExists(closedPath)) {
      const perf = await readJson<unknown>(closedPath);
      const performance = coerceSetupReviewPerformance(perf, closedPath);
      if (performance) {
        out.push({
          dateDir,
          fileKind: "closed",
          performance
        });
      } else {
        ignoredDueToVersion += 1;
      }
      continue;
    }

    if (await fileExists(openPath)) {
      const perf = await readJson<unknown>(openPath);
      const performance = coerceSetupReviewPerformance(perf, openPath);
      if (performance) {
        out.push({
          dateDir,
          fileKind: "open",
          performance
        });
      } else {
        ignoredDueToVersion += 1;
      }
    }
  }

  if (ignoredDueToVersion > 0) {
    console.warn("[setup-review] Ignored performances due to unsupported version", { setupDate, count: ignoredDueToVersion });
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
  let ignoredDueToVersion = 0;

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
        const perf = await readJson<unknown>(closedPath);
        const performance = coerceSetupReviewPerformance(perf, closedPath);
        if (performance) {
          out.push({
            dateDir,
            fileKind: "closed",
            performance
          });
        } else {
          ignoredDueToVersion += 1;
        }
        continue;
      }

      if (await fileExists(openPath)) {
        const perf = await readJson<unknown>(openPath);
        const performance = coerceSetupReviewPerformance(perf, openPath);
        if (performance) {
          out.push({
            dateDir,
            fileKind: "open",
            performance
          });
        } else {
          ignoredDueToVersion += 1;
        }
      }
    }
  }

  if (ignoredDueToVersion > 0) {
    console.warn("[setup-review] Ignored performances due to unsupported version", { count: ignoredDueToVersion });
  }

  return out;
}
