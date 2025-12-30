import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { withFileLock } from "./fileLock";
import { fileExists } from "./fsUtils";
import type { ExistingSnapshotMode } from "./snapshotTypes";
import type { CnbcVideoArticle, MarketNewsArticle, MarketNewsSnapshot, StoredCnbcVideoArticle } from "./types";

const CNBC_VIDEO_DIR = path.join(process.cwd(), "content", "data", "cnbc");

const cnbcReadCache = new Map<string, CnbcVideoArticle[]>();

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === "string") {
      return code;
    }
  }

  return undefined;
}

async function readJson<T>(filePath: string): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code === "ENOENT") {
      const err = new Error(`[market:cnbc-storage] Missing CNBC video file: ${filePath}`);
      (err as unknown as { code?: string }).code = code;
      (err as unknown as { cause?: unknown }).cause = error;
      throw err;
    }

    throw error;
  }
}

function formatCnbcVideoFileDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`[market:cnbc-storage] Invalid date: ${date}. Expected YYYY-MM-DD.`);
  }

  return date.replace(/-/g, "");
}

function getCnbcVideoDateDir(date: string): string {
  const fileDate = formatCnbcVideoFileDate(date);
  return path.join(CNBC_VIDEO_DIR, fileDate);
}

function normalizeCnbcSymbol(symbol: string | null): string | null {
  if (symbol && symbol.toLowerCase() === "cnbc") {
    return null;
  }

  return symbol;
}

const MIN_CNBC_VIDEO_YEAR = 2000;
const MAX_FUTURE_YEAR_OFFSET = 1;

const warnedInvalidCnbcVideoDateDirs = new Set<string>();

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidIsoDateYmd(value: string, now = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }

  const currentYear = now.getUTCFullYear();
  if (year < MIN_CNBC_VIDEO_YEAR || year > currentYear + MAX_FUTURE_YEAR_OFFSET) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  if (day < 1 || day > 31) {
    return false;
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ][month - 1];

  if (typeof daysInMonth !== "number" || day > daysInMonth) {
    return false;
  }

  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/**
* Reads CNBC video articles for a day (ISO `YYYY-MM-DD`).
*
* The on-disk schema includes `provider`, `fetchedAt`, and `asOfDate` on each object.
*
* `provider` is implied by the file path and is omitted from the returned in-memory
* objects.
*/
export async function readCnbcVideoArticles(date: string): Promise<CnbcVideoArticle[]> {
  const dirPath = getCnbcVideoDateDir(date);

  const cached = cnbcReadCache.get(dirPath);
  if (cached) {
    return cached;
  }

  let entries: Array<{ name: string; isFile: boolean }> = [];
  try {
    const raw = await readdir(dirPath, { withFileTypes: true });
    entries = raw.map((entry) => ({ name: entry.name, isFile: entry.isFile() }));
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code === "ENOENT") {
      const err = new Error(`[market:cnbc-storage] Missing CNBC video directory: ${dirPath}`);
      (err as unknown as { code?: string }).code = code;
      (err as unknown as { cause?: unknown }).cause = error;
      throw err;
    }

    throw error;
  }

  const files = entries
    .filter((e) => e.isFile)
    .map((e) => e.name)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const articles: CnbcVideoArticle[] = [];

  for (const name of files) {
    const filePath = path.join(dirPath, name);
    const stored = await readJson<StoredCnbcVideoArticle>(filePath);

    if (stored.provider !== "cnbc" || stored.asOfDate !== date) {
      throw new Error(
        `[market:cnbc-storage] Unexpected CNBC article metadata in ${filePath}: ${JSON.stringify({
          id: stored.id,
          provider: stored.provider,
          asOfDate: stored.asOfDate,
          expectedAsOfDate: date
        })}`
      );
    }

    if (stored.symbol !== null && typeof stored.symbol !== "string") {
      throw new Error(
        `[market:cnbc-storage] Invalid CNBC symbol type in ${filePath}: ${JSON.stringify({
          id: stored.id,
          symbol: stored.symbol
        })}`
      );
    }

    const { provider: _provider, symbol, ...article } = stored;
    articles.push({
      ...article,
      symbol: normalizeCnbcSymbol(symbol)
    });
  }

  cnbcReadCache.set(dirPath, articles);
  return articles;
}

/**
* Lists all available CNBC video dates as ISO `YYYY-MM-DD` strings.
*/
export async function listCnbcVideoDates(): Promise<string[]> {
  const dirKey = path.resolve(CNBC_VIDEO_DIR);

  let entries: Array<{ name: string; isDir: boolean }> = [];
  try {
    const raw = await readdir(CNBC_VIDEO_DIR, { withFileTypes: true });
    entries = raw.map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }));
  } catch (error) {
    const code = nodeErrorCode(error);

    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const candidates = entries
    .filter((e) => e.isDir)
    .map((e) => e.name)
    .filter((name) => /^\d{8}$/.test(name))
    .map((name) => `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}`);

  const dates: string[] = [];
  const invalidDatesSample: string[] = [];
  let invalidCount = 0;

  for (const date of candidates) {
    if (isValidIsoDateYmd(date)) {
      dates.push(date);
      continue;
    }

    invalidCount += 1;

    if (invalidDatesSample.length < 5) {
      invalidDatesSample.push(date);
    }
  }

  if (invalidCount > 0) {
    const message = `[market:cnbc-storage] Ignoring ${invalidCount} invalid CNBC video date folder(s) in ${CNBC_VIDEO_DIR} (expected valid YYYYMMDD folder)`;
    if (process.env.NODE_ENV !== "production") {
      console.warn(`${message}: ${invalidDatesSample.join(", ")}`);
    } else if (!warnedInvalidCnbcVideoDateDirs.has(dirKey)) {
      warnedInvalidCnbcVideoDateDirs.add(dirKey);
      const sample = invalidDatesSample[0];
      console.warn(sample ? `${message}: e.g. ${sample}` : message);
    }
  }

  return dates.sort();
}

export async function cnbcVideoSnapshotExists(date: string): Promise<boolean> {
  return fileExists(getCnbcVideoDateDir(date));
}

export type WriteCnbcVideoSnapshotResult =
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
    topic: existingTopic ?? incomingTopic,
    hype: normalizedIncoming.hype ?? existing.hype,
    relatedTickers:
      normalizedIncoming.relatedTickers.length > 0 ? normalizedIncoming.relatedTickers : existing.relatedTickers
  };

  const changed = JSON.stringify(merged) !== JSON.stringify(existing);
  return { merged, changed };
}

function toStoredCnbcArticle(snapshot: MarketNewsSnapshot, article: MarketNewsArticle): StoredCnbcVideoArticle {
  const uniqRelatedTickers = Array.from(new Set(article.relatedTickers));

  return {
    id: article.id,
    title: article.title,
    url: article.url,
    thumbnailUrl: article.thumbnailUrl,
    publisher: article.publisher,
    publishedAt: article.publishedAt,
    relatedTickers: uniqRelatedTickers,
    topic: article.topic,
    hype: article.hype,
    mainIdea: article.mainIdea,
    summary: article.summary,
    symbol: uniqRelatedTickers.length === 1 ? uniqRelatedTickers[0] ?? null : null,
    provider: snapshot.provider,
    fetchedAt: snapshot.fetchedAt,
    asOfDate: snapshot.asOfDate
  };
}

function safeBasename(value: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const collapsed = sanitized.replace(/-+/g, "-").replace(/^-|-$/g, "");

  return collapsed.length > 0 ? collapsed : "video";
}

function getCnbcVideoFilePath(date: string, stored: StoredCnbcVideoArticle): string {
  const dirPath = getCnbcVideoDateDir(date);
  const stem = safeBasename(stored.id);
  return path.join(dirPath, `${stem}.json`);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeCnbcVideoSnapshot(
  date: string,
  snapshot: MarketNewsSnapshot,
  opts: {
    mode?: ExistingSnapshotMode;
  } = {}
): Promise<WriteCnbcVideoSnapshotResult> {
  if (snapshot.symbol !== "cnbc") {
    throw new Error(`[market:cnbc-storage] writeCnbcVideoSnapshot called with non-CNBC symbol: ${snapshot.symbol}`);
  }
  if (snapshot.asOfDate !== date) {
    throw new Error(
      `[market:cnbc-storage] CNBC snapshot asOfDate mismatch: snapshot.asOfDate=${snapshot.asOfDate}, pathDate=${date}`
    );
  }

  const dirPath = getCnbcVideoDateDir(date);
  await mkdir(CNBC_VIDEO_DIR, { recursive: true });

  return withFileLock({ filePath: dirPath, logPrefix: "market:cnbc-storage" }, async () => {
    if ((await fileExists(dirPath)) && opts.mode !== "fill_existing") {
      return { status: "skipped_existing" as const, path: dirPath };
    }

    await mkdir(dirPath, { recursive: true });

    let changed = false;

    for (const article of snapshot.articles) {
      const storedArticle = toStoredCnbcArticle(snapshot, article);
      const filePath = getCnbcVideoFilePath(date, storedArticle);
      const tmpPath = `${filePath}.tmp`;

      if (await fileExists(filePath)) {
        if (opts.mode !== "fill_existing") {
          continue;
        }

        const existingStored = await readJson<StoredCnbcVideoArticle>(filePath);
        if (existingStored.provider !== "cnbc" || existingStored.asOfDate !== date) {
          throw new Error(
            `[market:cnbc-storage] Unexpected CNBC article metadata in ${filePath}: ${JSON.stringify({
              provider: existingStored.provider,
              asOfDate: existingStored.asOfDate
            })}`
          );
        }

        const existingNews: MarketNewsArticle = {
          id: existingStored.id,
          title: existingStored.title,
          url: existingStored.url,
          thumbnailUrl: existingStored.thumbnailUrl,
          publisher: existingStored.publisher,
          publishedAt: existingStored.publishedAt,
          relatedTickers: existingStored.relatedTickers,
          topic: existingStored.topic,
          hype: existingStored.hype,
          mainIdea: existingStored.mainIdea,
          summary: existingStored.summary
        };

        const incomingNews: MarketNewsArticle = {
          id: storedArticle.id,
          title: storedArticle.title,
          url: storedArticle.url,
          thumbnailUrl: storedArticle.thumbnailUrl,
          publisher: storedArticle.publisher,
          publishedAt: storedArticle.publishedAt,
          relatedTickers: storedArticle.relatedTickers,
          topic: storedArticle.topic,
          hype: storedArticle.hype,
          mainIdea: storedArticle.mainIdea,
          summary: storedArticle.summary
        };

        const mergedRes = mergeNewsArticles(existingNews, incomingNews);
        const mergedRelatedTickers = Array.from(new Set(mergedRes.merged.relatedTickers));
        const mergedStored: StoredCnbcVideoArticle = {
          ...existingStored,
          ...mergedRes.merged,
          relatedTickers: mergedRelatedTickers,
          symbol: mergedRelatedTickers.length === 1 ? mergedRelatedTickers[0] ?? null : null,
          fetchedAt:
            existingStored.fetchedAt.localeCompare(snapshot.fetchedAt) >= 0 ? existingStored.fetchedAt : snapshot.fetchedAt
        };

        if (!mergedRes.changed && existingStored.fetchedAt === mergedStored.fetchedAt) {
          continue;
        }

        await writeJsonFile(tmpPath, mergedStored);
        await rename(tmpPath, filePath);
        changed = true;
        continue;
      }

      await writeJsonFile(tmpPath, storedArticle);
      await rename(tmpPath, filePath);
      changed = true;
    }

    if (changed) {
      cnbcReadCache.delete(dirPath);
    }

    return { status: changed ? ("written" as const) : ("skipped_existing" as const), path: dirPath };
  });
}
