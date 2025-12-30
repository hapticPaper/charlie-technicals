import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { parseIsoDateYmd } from "./date";
import { readCnbcVideoArticles as readCnbcVideoArticlesFromStorage } from "./cnbcVideoStorage";
import type {
  CnbcVideoArticle,
  MarketReport,
  MarketReportHighlights
} from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");
const REPORTS_DIR = path.join(CONTENT_DIR, "reports");

function normalizeAndValidateCnbcAsOfDate(date: string): string {
  const asOfDate = /^\d{8}$/.test(date)
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;

  try {
    parseIsoDateYmd(asOfDate);
  } catch (error) {
    throw new Error(
      `[market:reportStorage] Invalid CNBC asOfDate. Expected YYYYMMDD or YYYY-MM-DD. normalized=${asOfDate}, input=${date}`,
      { cause: error }
    );
  }

  return asOfDate;
}

function assertReportDateIsoYmd(date: string): void {
  try {
    parseIsoDateYmd(date);
  } catch (error) {
    throw new Error(`[market:reportStorage] Invalid report date: ${date}`, { cause: error });
  }
}

export function getReportJsonPath(date: string): string {
  assertReportDateIsoYmd(date);
  return path.join(REPORTS_DIR, `${date}.json`);
}

export function getReportHighlightsJsonPath(date: string): string {
  assertReportDateIsoYmd(date);
  return path.join(REPORTS_DIR, `${date}.highlights.json`);
}

export function getReportSummaryWidgetsJsonPath(date: string): string {
  assertReportDateIsoYmd(date);
  return path.join(REPORTS_DIR, `${date}.summary.json`);
}

export function getReportMdxPath(date: string): string {
  assertReportDateIsoYmd(date);
  return path.join(REPORTS_DIR, `${date}.mdx`);
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

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const baseMessage = `[market:reportStorage] Failed to parse JSON: ${filePath}`;
    if (error instanceof SyntaxError) {
      throw new Error(`${baseMessage}: ${error.message}`, { cause: error });
    }

    const message = error instanceof Error ? `${baseMessage}: ${error.message}` : baseMessage;
    throw new Error(message, { cause: error });
  }
}

/**
* Reads CNBC video articles for a day.
*
* The on-disk schema includes `provider`, `fetchedAt`, and `asOfDate` on each object.
*
* `date` can be either `YYYY-MM-DD` or `YYYYMMDD`, and is normalized to `YYYY-MM-DD`.
*
* `provider` is implied by the file path and is omitted from the returned in-memory
* objects.
*/
export async function readCnbcVideoArticles(date: string): Promise<CnbcVideoArticle[]> {
  const asOfDate = normalizeAndValidateCnbcAsOfDate(date);
  return readCnbcVideoArticlesFromStorage(asOfDate);
}

export async function listReportDates(): Promise<string[]> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(REPORTS_DIR, { withFileTypes: true });
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
    // Only treat regular files as reports; ignore directories, symlinks, etc.
    .filter((e) => e.isFile() && e.name.endsWith(".mdx"))
    .map((e) => e.name.replace(/\.mdx$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}
