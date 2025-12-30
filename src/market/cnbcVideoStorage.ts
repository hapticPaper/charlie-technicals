import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { CnbcVideoArticle, StoredCnbcVideoArticle } from "./types";

const CNBC_NEWS_DIR = path.join(process.cwd(), "content", "data", "cnbc", "news");

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

function getCnbcVideoPath(date: string): string {
  const fileDate = formatCnbcVideoFileDate(date);
  return path.join(CNBC_NEWS_DIR, `${fileDate}.json`);
}

function normalizeCnbcSymbol(symbol: StoredCnbcVideoArticle["symbol"]): string | null {
  if (typeof symbol === "string" && symbol.toLowerCase() === "cnbc") {
    return null;
  }

  return symbol ?? null;
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
* Reads CNBC video articles for a day.
*
* The on-disk schema includes `provider`, `fetchedAt`, and `asOfDate` on each object.
*
* `provider` is implied by the file path and is omitted from the returned in-memory
* objects.
*/
export async function readCnbcVideoArticles(date: string): Promise<CnbcVideoArticle[]> {
  const filePath = getCnbcVideoPath(date);
  const stored = await readJson<StoredCnbcVideoArticle[]>(filePath);

  for (const article of stored) {
    // Contract: the persistence layer must write consistent per-day metadata for every record.
    if (article.provider !== "cnbc" || article.asOfDate !== date) {
      throw new Error(
        `[market:cnbc-storage] Unexpected CNBC article metadata in ${filePath}: ${JSON.stringify({
          provider: article.provider,
          asOfDate: article.asOfDate
        })}`
      );
    }

    if (article.symbol !== null && typeof article.symbol !== "string") {
      throw new Error(
        `[market:cnbc-storage] Invalid CNBC symbol type in ${filePath}: ${JSON.stringify({
          symbol: article.symbol
        })}`
      );
    }
  }

  // Legacy snapshots persisted `symbol: "cnbc"` on each record; normalize that to `null`.
  return stored.map(({ provider: _provider, symbol, ...article }) => ({
    ...article,
    symbol: normalizeCnbcSymbol(symbol)
  }));
}

export async function listCnbcVideoDates(): Promise<string[]> {
  const dirKey = path.resolve(CNBC_NEWS_DIR);

  let entries: Array<{ name: string; isFile: boolean }> = [];
  try {
    const raw = await readdir(CNBC_NEWS_DIR, { withFileTypes: true });
    entries = raw.map((entry) => ({ name: entry.name, isFile: entry.isFile() }));
  } catch (error) {
    const code = nodeErrorCode(error);

    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const candidates = entries
    .filter((e) => e.isFile)
    .map((e) => e.name)
    .filter((e) => e.endsWith(".json"))
    .map((e) => e.replace(/\.json$/, ""))
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
    const message = `[market:cnbc-storage] Ignoring ${invalidCount} invalid CNBC video date file(s) in ${CNBC_NEWS_DIR} (expected YYYYMMDD.json)`;
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
