import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { formatRawDataFileDate } from "./dataConventions";
import { parseIsoDateYmd } from "./date";
import type {
  CnbcVideoArticle,
  MarketReport,
  MarketReportHighlights,
  StoredCnbcVideoArticle
} from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");
const REPORTS_DIR = path.join(CONTENT_DIR, "reports");
const CNBC_NEWS_DIR = path.join(CONTENT_DIR, "data", "cnbc", "news");

function normalizeCnbcAsOfDate(date: string): string {
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

export function getReportJsonPath(date: string): string {
  return path.join(REPORTS_DIR, `${date}.json`);
}

export function getReportHighlightsJsonPath(date: string): string {
  return path.join(REPORTS_DIR, `${date}.highlights.json`);
}

export function getReportMdxPath(date: string): string {
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
      throw new SyntaxError(`${baseMessage}: ${error.message}`, { cause: error });
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
  const asOfDate = normalizeCnbcAsOfDate(date);

  const fileDate = formatRawDataFileDate(asOfDate);
  const filePath = path.join(CNBC_NEWS_DIR, `${fileDate}.json`);
  const stored = await readJson<StoredCnbcVideoArticle[]>(filePath);

  for (const article of stored) {
    let articleAsOfDate = article.asOfDate;
    if (articleAsOfDate !== asOfDate) {
      articleAsOfDate = normalizeCnbcAsOfDate(articleAsOfDate);
    }

    if (article.provider !== "cnbc" || articleAsOfDate !== asOfDate) {
      throw new Error(
        `[market:reportStorage] Unexpected CNBC article metadata in ${filePath}: ${JSON.stringify({
          provider: article.provider,
          asOfDate: article.asOfDate,
          normalizedAsOfDate: articleAsOfDate,
          expectedAsOfDate: asOfDate
        })}`
      );
    }

    if (article.symbol !== null && typeof article.symbol !== "string") {
      throw new Error(
        `[market:reportStorage] Invalid CNBC symbol type in ${filePath}: ${JSON.stringify({
          symbol: article.symbol
        })}`
      );
    }
  }

  // Legacy snapshots persisted `symbol: "cnbc"` on each record; normalize that to `null`.
  return stored.map(({ provider: _provider, symbol, ...article }) => ({
    ...article,
    symbol: typeof symbol === "string" && symbol.toLowerCase() === "cnbc" ? null : symbol ?? null
  }));
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
