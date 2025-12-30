import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatRawDataFileDate } from "./dataConventions";
import {
  cnbcVideoSnapshotExists,
  listCnbcVideoDates as listCnbcVideoDatesFromStorage,
  readCnbcVideoArticles as readCnbcVideoArticlesFromStorage,
  writeCnbcVideoSnapshot
} from "./cnbcVideoStorage";
import { withFileLock } from "./fileLock";
import { fileExists } from "./fsUtils";
import { getReportSummaryWidgetsJsonPath as getValidatedReportSummaryWidgetsJsonPath } from "./reportStorage";
import type { ExistingSnapshotMode } from "./snapshotTypes";
import type {
  AnalyzedSeries,
  CnbcVideoArticle,
  MarketInterval,
  MarketNewsArticle,
  MarketNewsSnapshot,
  MarketReport,
  MarketReportHighlights
} from "./types";

import { buildReportSummaryWidgets } from "./summaryWidgets";

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

export function getNewsDir(symbol: string): string {
  return path.join(getDataDir(), safeSymbol(symbol), "news");
}

export function getNewsPath(date: string, symbol: string): string {
  const fileDate = formatRawDataFileDate(date);
  return path.join(getNewsDir(symbol), `${fileDate}.json`);
}

export function getAnalyzedSeriesPath(date: string, symbol: string, interval: MarketInterval): string {
  return path.join(getAnalysisDir(date), `${safeSymbol(symbol)}.${interval}.json`);
}

export function getReportJsonPath(date: string): string {
  return path.join(getReportsDir(), `${date}.json`);
}

export function getReportHighlightsJsonPath(date: string): string {
  return path.join(getReportsDir(), `${date}.highlights.json`);
}

/**
* Resolve the validated on-disk path for the report summary widgets cache.
*
* Delegates to `reportStorage.getReportSummaryWidgetsJsonPath` so date validation and naming
* conventions stay consistent across the codebase.
*/
export function getReportSummaryWidgetsJsonPath(date: string): string {
  return getValidatedReportSummaryWidgetsJsonPath(date);
}

export function toReportHighlights(report: MarketReport): MarketReportHighlights {
  return {
    version: "v2-highlights",
    date: report.date,
    generatedAt: report.generatedAt,
    picks: report.picks.map((p) => ({
      symbol: p.symbol,
      trade: {
        side: p.trade.side,
        entry: p.trade.entry,
        stop: p.trade.stop
      }
    })),
    summaries: {
      veryShort: report.summaries.veryShort,
      mainIdea: report.summaries.mainIdea
    }
  };
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

/**
* Reads CNBC video articles for a day.
*
* The on-disk schema includes `provider`, `fetchedAt`, and `asOfDate` on each object.
*
* `provider` is implied by the file path and is omitted from the returned in-memory
* objects.
*/
export async function readCnbcVideoArticles(date: string): Promise<CnbcVideoArticle[]> {
  return readCnbcVideoArticlesFromStorage(date);
}

export type StoredNewsData =
  | { kind: "snapshot"; snapshot: MarketNewsSnapshot }
  | { kind: "cnbc_articles"; articles: CnbcVideoArticle[] };

/**
* Preferred read API for news data.
*
* Note: `symbol === "cnbc"` is stored on disk as one JSON file per video under
* `content/data/cnbc/<YYYYMMDD>/*.json`.
*/
export async function readNewsData(date: string, symbol: string): Promise<StoredNewsData> {
  if (symbol === "cnbc") {
    return { kind: "cnbc_articles", articles: await readCnbcVideoArticles(date) };
  }

  return { kind: "snapshot", snapshot: await readJson<MarketNewsSnapshot>(getNewsPath(date, symbol)) };
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

export async function listCnbcVideoDates(): Promise<string[]> {
  return listCnbcVideoDatesFromStorage();
}

export async function newsSnapshotExists(date: string, symbol: string): Promise<boolean> {
  if (symbol === "cnbc") {
    return cnbcVideoSnapshotExists(date);
  }

  return fileExists(getNewsPath(date, symbol));
}

export type WriteNewsSnapshotResult =
  | { status: "written"; path: string }
  | { status: "skipped_existing"; path: string };

function normalizeNewsArticleForMerge(article: MarketNewsArticle): MarketNewsArticle {
  const normalizedThumbnailUrl =
    typeof article.thumbnailUrl === "string"
      ? article.thumbnailUrl.trim() !== ""
        ? article.thumbnailUrl.trim()
        : null
      : article.thumbnailUrl;

  return {
    ...article,
    thumbnailUrl: normalizedThumbnailUrl,
    relatedTickers: Array.from(new Set(article.relatedTickers))
  };
}

function mergeNewsArticles(existing: MarketNewsArticle, incoming: MarketNewsArticle): {
  merged: MarketNewsArticle;
  changed: boolean;
} {
  const normalizedIncoming = normalizeNewsArticleForMerge(incoming);
  const existingTopic =
    typeof existing.topic === "string" && existing.topic.trim() !== "" ? existing.topic : undefined;
  const incomingTopic =
    typeof normalizedIncoming.topic === "string" && normalizedIncoming.topic.trim() !== ""
      ? normalizedIncoming.topic
      : undefined;
  const merged: MarketNewsArticle = {
    ...normalizedIncoming,
    thumbnailUrl: normalizedIncoming.thumbnailUrl ?? existing.thumbnailUrl,
    // Preserve any previously-enriched topic values (they may be human-curated or hand-corrected).
    topic: existingTopic ?? incomingTopic,
    hype: normalizedIncoming.hype ?? existing.hype,
    relatedTickers:
      normalizedIncoming.relatedTickers.length > 0 ? normalizedIncoming.relatedTickers : existing.relatedTickers
  };

  const changed = JSON.stringify(merged) !== JSON.stringify(existing);
  return { merged, changed };
}

function sortNewsArticles(articles: MarketNewsArticle[]): MarketNewsArticle[] {
  return [...articles].sort((a, b) => {
    const byDate = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (byDate !== 0) {
      return byDate;
    }
    return a.id.localeCompare(b.id);
  });
}

function serializeNewsSnapshotForStorage(snapshot: MarketNewsSnapshot): unknown {
  return snapshot;
}

/**
* Writes a news snapshot for a given symbol/date.
*
* Note: `symbol === "cnbc"` snapshots are stored separately via `writeCnbcVideoSnapshot`.
*
* News snapshots are immutable: if the target file already exists, the write is
* skipped and the existing snapshot is left untouched.
*/
export async function writeNewsSnapshot(
  date: string,
  snapshot: MarketNewsSnapshot,
  opts: {
    mode?: ExistingSnapshotMode;
  } = {}
): Promise<WriteNewsSnapshotResult> {
  if (snapshot.symbol === "cnbc") {
    return writeCnbcVideoSnapshot(date, snapshot, opts);
  }

  if (snapshot.asOfDate !== date) {
    throw new Error(
      `[market:storage] News snapshot asOfDate mismatch for ${snapshot.symbol}: snapshot.asOfDate=${snapshot.asOfDate}, pathDate=${date}`
    );
  }

  const filePath = getNewsPath(date, snapshot.symbol);
  const tmpPath = `${filePath}.tmp`;

  await mkdir(path.dirname(filePath), { recursive: true });

  const res = await withFileLock({ filePath, logPrefix: "market:storage" }, async () => {
    if (await fileExists(filePath)) {
      if (opts.mode !== "fill_existing") {
        return { status: "skipped_existing" as const, path: filePath };
      }

      const existingSnapshot = await readJson<MarketNewsSnapshot>(filePath);

      if (existingSnapshot.symbol !== snapshot.symbol) {
        throw new Error(
          `[market:storage] News snapshot symbol mismatch in ${filePath}: expected ${snapshot.symbol}, got ${existingSnapshot.symbol}`
        );
      }

      if (existingSnapshot.asOfDate !== date) {
        throw new Error(
          `[market:storage] News snapshot asOfDate mismatch in ${filePath}: expected ${date}, got ${existingSnapshot.asOfDate}`
        );
      }

      if (existingSnapshot.provider !== snapshot.provider) {
        throw new Error(
          `[market:storage] News snapshot provider mismatch in ${filePath}: ${existingSnapshot.provider} vs ${snapshot.provider}`
        );
      }

      const existingById = new Map(existingSnapshot.articles.map((a) => [a.id, a] as const));
      const mergedById = new Map<string, MarketNewsArticle>();
      let changed = false;

      for (const incoming of snapshot.articles) {
        const prev = existingById.get(incoming.id);
        if (!prev) {
          mergedById.set(incoming.id, normalizeNewsArticleForMerge(incoming));
          changed = true;
          continue;
        }

        const res = mergeNewsArticles(prev, incoming);
        mergedById.set(incoming.id, res.merged);
        if (res.changed) {
          changed = true;
        }
      }

      for (const prev of existingSnapshot.articles) {
        if (!mergedById.has(prev.id)) {
          mergedById.set(prev.id, prev);
        }
      }

      const mergedArticles = sortNewsArticles(Array.from(mergedById.values()));
      const existingArticlesSorted = sortNewsArticles(existingSnapshot.articles);

      if (!changed && JSON.stringify(existingArticlesSorted) === JSON.stringify(mergedArticles)) {
        return { status: "skipped_existing" as const, path: filePath };
      }

      const mergedSnapshot: MarketNewsSnapshot = {
        ...existingSnapshot,
        fetchedAt:
          existingSnapshot.fetchedAt.localeCompare(snapshot.fetchedAt) >= 0
            ? existingSnapshot.fetchedAt
            : snapshot.fetchedAt,
        articles: mergedArticles
      };

      await writeJson(tmpPath, serializeNewsSnapshotForStorage(mergedSnapshot));
      await rename(tmpPath, filePath);
      return { status: "written" as const, path: filePath };
    }

    await writeJson(tmpPath, serializeNewsSnapshotForStorage(snapshot));
    await rename(tmpPath, filePath);
    return { status: "written" as const, path: filePath };
  });

  return res;
}

export async function writeAnalyzedSeries(date: string, series: AnalyzedSeries): Promise<void> {
  await writeJson(getAnalyzedSeriesPath(date, series.symbol, series.interval), series);
}

export async function writeReport(date: string, report: MarketReport, mdx: string): Promise<void> {
  const jsonPath = getReportJsonPath(date);
  const highlightsPath = getReportHighlightsJsonPath(date);
  const summaryWidgetsPath = getReportSummaryWidgetsJsonPath(date);
  const mdxPath = getReportMdxPath(date);
  const jsonTmp = `${jsonPath}.tmp`;
  const highlightsTmp = `${highlightsPath}.tmp`;
  const summaryWidgetsTmp = `${summaryWidgetsPath}.tmp`;
  const mdxTmp = `${mdxPath}.tmp`;

  await Promise.allSettled([
    rm(jsonTmp, { force: true }),
    rm(highlightsTmp, { force: true }),
    rm(summaryWidgetsTmp, { force: true }),
    rm(mdxTmp, { force: true })
  ]);

  await writeJson(jsonTmp, report);
  await writeFile(mdxTmp, mdx, "utf8");

  // Commit canonical report artifacts first; derived caches (highlights/summary widgets) are best-effort
  // and should not block publishing the report.
  try {
    await rename(jsonTmp, jsonPath);
    await rename(mdxTmp, mdxPath);
  } catch (error) {
    await Promise.allSettled([
      rm(jsonTmp, { force: true }),
      rm(highlightsTmp, { force: true }),
      rm(summaryWidgetsTmp, { force: true }),
      rm(mdxTmp, { force: true })
    ]);
    throw error;
  }

  const cleanupTmp = async (tmpPath: string) => {
    await rm(tmpPath, { force: true }).catch(() => {
      // Best-effort cleanup.
    });
  };

  const cleanupTmpAndFinal = async (tmpPath: string, finalPath: string) => {
    await Promise.allSettled([rm(tmpPath, { force: true }), rm(finalPath, { force: true })]);
  };

  const safeRenameCache = async (tmpPath: string, finalPath: string, label: string) => {
    try {
      await rename(tmpPath, finalPath);
    } catch (error) {
      // Prefer a missing cache over a potentially stale cache.
      await cleanupTmpAndFinal(tmpPath, finalPath);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[market:storage] ${label} cache not updated for ${date}: ${finalPath}: ${message}`);
    }
  };

  try {
    await writeJson(highlightsTmp, toReportHighlights(report));
    await safeRenameCache(highlightsTmp, highlightsPath, "Highlights");
  } catch (error) {
    // Preserve the last known-good cache when writing a new tmp file fails.
    await cleanupTmp(highlightsTmp);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[market:storage] Failed writing highlights cache for ${date}: ${highlightsPath}: ${message}`);
  }

  try {
    await writeJson(summaryWidgetsTmp, buildReportSummaryWidgets(report));
    await safeRenameCache(summaryWidgetsTmp, summaryWidgetsPath, "Summary widgets");
  } catch (error) {
    // Preserve the last known-good cache when writing a new tmp file fails.
    await cleanupTmp(summaryWidgetsTmp);
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[market:storage] Failed writing summary widgets cache for ${date}: ${summaryWidgetsPath}: ${message}`
    );
  }
}
