import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatRawDataFileDate, rawDataWindowRequirementFor } from "./dataConventions";
import type { AnalyzedSeries, MarketInterval, MarketNewsSnapshot, MarketReport, RawSeries } from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");

function safeSymbol(symbol: string): string {
  return encodeURIComponent(symbol);
}

export function getContentDir(): string {
  return CONTENT_DIR;
}

export function getDataDir(): string {
  return path.join(CONTENT_DIR, "data");
}

export function getAnalysisDir(date: string): string {
  return path.join(CONTENT_DIR, "analysis", date);
}

export function getReportsDir(): string {
  return path.join(CONTENT_DIR, "reports");
}

export function getRawSeriesDir(symbol: string, interval: MarketInterval): string {
  return path.join(getDataDir(), safeSymbol(symbol), interval);
}

export function getNewsDir(symbol: string): string {
  return path.join(getDataDir(), safeSymbol(symbol), "news");
}

export function getRawSeriesPath(date: string, symbol: string, interval: MarketInterval): string {
  const fileDate = formatRawDataFileDate(date);
  return path.join(getRawSeriesDir(symbol, interval), `${fileDate}.json`);
}

export function getNewsPath(date: string, symbol: string): string {
  const fileDate = formatRawDataFileDate(date);
  return path.join(getNewsDir(symbol), `${fileDate}.json`);
}

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();
  const timeoutMs = 5000;

  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;

      if (code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - start > timeoutMs) {
        console.error(
          `[market:storage] Lock timeout for ${filePath}; possible stale lock at ${lockPath}`
        );
        throw new Error(`Timed out acquiring lock for ${filePath}`);
      }

      await new Promise((r) => setTimeout(r, 25));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function mergeBars(
  existing: RawSeries["bars"],
  incoming: RawSeries["bars"]
): RawSeries["bars"] {
  // `t` must be ISO-8601 so `localeCompare` keeps chronological ordering.
  const ensureSorted = (bars: RawSeries["bars"], label: string): RawSeries["bars"] => {
    for (let idx = 1; idx < bars.length; idx += 1) {
      if (bars[idx - 1].t.localeCompare(bars[idx].t) > 0) {
        console.error(
          `[market:storage] Non-monotonic bar timestamps detected in ${label}; sorting before merge`
        );
        return [...bars].sort((a, b) => a.t.localeCompare(b.t));
      }
    }

    return bars;
  };

  const left = ensureSorted(existing, "existing");
  const right = ensureSorted(incoming, "incoming");

  const out: RawSeries["bars"] = [];
  let i = 0;
  let j = 0;

  function pushBar(bar: RawSeries["bars"][number]): void {
    const last = out[out.length - 1];
    if (last?.t === bar.t) {
      out[out.length - 1] = bar;
      return;
    }

    out.push(bar);
  }

  while (i < left.length && j < right.length) {
    const e = left[i];
    const n = right[j];
    const cmp = e.t.localeCompare(n.t);

    if (cmp < 0) {
      pushBar(e);
      i += 1;
      continue;
    }

    if (cmp > 0) {
      pushBar(n);
      j += 1;
      continue;
    }

    // Same timestamp: prefer incoming.
    pushBar(n);
    i += 1;
    j += 1;
  }

  while (i < left.length) {
    pushBar(left[i]);
    i += 1;
  }

  while (j < right.length) {
    pushBar(right[j]);
    j += 1;
  }

  return out;
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

export async function ensureDataDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

export async function ensureAnalysisDir(date: string): Promise<void> {
  await mkdir(getAnalysisDir(date), { recursive: true });
}

export async function ensureReportsDir(): Promise<void> {
  await mkdir(getReportsDir(), { recursive: true });
}

/**
* @deprecated Use `ensureDataDir`, `ensureAnalysisDir`, and `ensureReportsDir` instead.
*/
export async function ensureDirs(date: string): Promise<void> {
  await ensureDataDir();
  await ensureAnalysisDir(date);
  await ensureReportsDir();
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function rawSeriesSnapshotExists(
  date: string,
  symbol: string,
  interval: MarketInterval
): Promise<boolean> {
  return fileExists(getRawSeriesPath(date, symbol, interval));
}

export async function newsSnapshotExists(date: string, symbol: string): Promise<boolean> {
  return fileExists(getNewsPath(date, symbol));
}

export type WriteRawSeriesResult =
  | { status: "written"; path: string }
  | { status: "skipped_existing"; path: string };

/**
* Writes a raw OHLCV snapshot for a given symbol/interval/date.
*
* Raw snapshots are immutable: if the target file already exists, the write is
* skipped and the existing snapshot is left untouched.
*/
export async function writeRawSeries(date: string, series: RawSeries): Promise<WriteRawSeriesResult> {
  const filePath = getRawSeriesPath(date, series.symbol, series.interval);
  const tmpPath = `${filePath}.tmp`;

  await mkdir(path.dirname(filePath), { recursive: true });

  const res = await withFileLock(filePath, async () => {
    if (await fileExists(filePath)) {
      return { status: "skipped_existing" as const, path: filePath };
    }

    await writeJson(tmpPath, series);
    await rename(tmpPath, filePath);
    return { status: "written" as const, path: filePath };
  });

  return res;
}

export type WriteNewsSnapshotResult =
  | { status: "written"; path: string }
  | { status: "skipped_existing"; path: string };

/**
* Writes a news snapshot for a given symbol/date.
*
* News snapshots are immutable: if the target file already exists, the write is
* skipped and the existing snapshot is left untouched.
*/
export async function writeNewsSnapshot(
  date: string,
  snapshot: MarketNewsSnapshot
): Promise<WriteNewsSnapshotResult> {
  if (snapshot.asOfDate !== date) {
    throw new Error(
      `[market:storage] News snapshot asOfDate mismatch for ${snapshot.symbol}: snapshot.asOfDate=${snapshot.asOfDate}, pathDate=${date}`
    );
  }

  const filePath = getNewsPath(date, snapshot.symbol);
  const tmpPath = `${filePath}.tmp`;

  await mkdir(path.dirname(filePath), { recursive: true });

  const res = await withFileLock(filePath, async () => {
    if (await fileExists(filePath)) {
      return { status: "skipped_existing" as const, path: filePath };
    }

    await writeJson(tmpPath, snapshot);
    await rename(tmpPath, filePath);
    return { status: "written" as const, path: filePath };
  });

  return res;
}

export type RawSeriesWindowLoadResult =
  | { status: "ok"; selectedFiles: string[]; series: RawSeries }
  | { status: "not_found"; selectedFiles: string[] }
  | { status: "insufficient_window"; selectedFiles: string[]; requiredMinFiles: number };

export async function loadRawSeriesWindow(
  date: string,
  symbol: string,
  interval: MarketInterval
): Promise<RawSeriesWindowLoadResult> {
  const requirement = rawDataWindowRequirementFor(interval);
  const dir = getRawSeriesDir(symbol, interval);
  const target = formatRawDataFileDate(date);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === "ENOENT") {
      return { status: "not_found", selectedFiles: [] };
    }

    throw error;
  }

  const files = entries
    .filter((e) => e.endsWith(".json"))
    .map((e) => e.replace(/\.json$/, ""))
    .filter((d) => /^\d{8}$/.test(d))
    .filter((d) => d <= target)
    .sort();

  if (!files.includes(target)) {
    return { status: "not_found", selectedFiles: [] };
  }

  const startIndex = Math.max(0, files.length - requirement.idealFiles);
  const selected = files.slice(startIndex);
  if (selected.length < requirement.minFiles) {
    return {
      status: selected.length === 0 ? "not_found" : "insufficient_window",
      selectedFiles: selected,
      requiredMinFiles: requirement.minFiles
    };
  }

  let provider = "yahoo-finance";
  let fetchedAt = "";
  let bars: RawSeries["bars"] = [];
  for (const fileDate of selected) {
    const raw = await readJson<RawSeries>(path.join(dir, `${fileDate}.json`));

    if (raw.symbol !== symbol || raw.interval !== interval) {
      throw new Error(
        `[market:loadRawSeriesWindow] Mismatched series metadata in ${symbol}/${interval} ${fileDate}: expected ${symbol}/${interval}, got ${raw.symbol}/${raw.interval}`
      );
    }

    if (provider !== "yahoo-finance" && provider !== raw.provider) {
      throw new Error(
        `[market:loadRawSeriesWindow] Multiple providers for ${symbol} ${interval}: ${provider} and ${raw.provider}`
      );
    }

    provider = raw.provider;
    // ISO strings preserve chronological ordering under lexicographic compare.
    fetchedAt = fetchedAt === "" ? raw.fetchedAt : fetchedAt.localeCompare(raw.fetchedAt) >= 0 ? fetchedAt : raw.fetchedAt;
    bars = mergeBars(bars, raw.bars);
  }

  return {
    status: "ok",
    selectedFiles: selected,
    series: {
      symbol,
      interval,
      provider,
      fetchedAt,
      bars
    }
  };
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
