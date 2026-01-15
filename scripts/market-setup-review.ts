import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getArg, getDateArg } from "./lib/args";
import { buildSetupReviewPerformance } from "../src/market/setupReview";
import { parseIsoDateYmd } from "../src/market/date";
import { loadRawSeriesWindow } from "../src/market/rawSeriesStorage";
import { getReportJsonPath, listReportDates, readJson } from "../src/market/reportStorage";
import {
  getSetupReviewClosedPerformancePath,
  getSetupReviewMdxPath,
  getSetupReviewsDir,
  writeSetupReviewPerformance
} from "../src/market/setupReviewStorage";
import type {
  MarketBar,
  MarketReport,
  ReportPick,
  SetupReviewSetupType,
  TradePlan
} from "../src/market/types";
import { fileExists } from "../src/market/fsUtils";

function addDaysIso(date: string, days: number): string {
  const { year, month, day } = parseIsoDateYmd(date);
  const ts = Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000;
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

type SetupSpec = {
  setupDate: string;
  symbol: string;
  setupType: SetupReviewSetupType;
  trade: TradePlan;
};

function toSetupSpecs(report: MarketReport): SetupSpec[] {
  const bySymbol = new Map<string, { pick?: ReportPick; watch?: ReportPick }>();

  for (const pick of report.picks) {
    const prev = bySymbol.get(pick.symbol) ?? {};
    bySymbol.set(pick.symbol, { ...prev, pick });
  }

  for (const watch of report.watchlist ?? []) {
    const prev = bySymbol.get(watch.symbol) ?? {};
    bySymbol.set(watch.symbol, { ...prev, watch });
  }

  const setups: SetupSpec[] = [];
  for (const [symbol, entry] of bySymbol.entries()) {
    const pick = entry.pick;
    const watch = entry.watch;
    const setup = pick ?? watch;
    if (!setup) {
      continue;
    }

    const setupType: SetupReviewSetupType = pick && watch ? "both" : pick ? "pick" : "watchlist";
    setups.push({ setupDate: report.date, symbol, setupType, trade: setup.trade });
  }

  return setups.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

const argv = process.argv.slice(2);
const asOfDate = getDateArg(argv);
const windowDays = Number(getArg(argv, "windowDays") ?? 40);
if (!Number.isFinite(windowDays) || windowDays <= 0) {
  throw new Error(`Invalid --windowDays: ${String(getArg(argv, "windowDays"))}`);
}

const force = getArg(argv, "force") === "true" || argv.includes("--force");

const minReportDate = addDaysIso(asOfDate, -windowDays);

const dates = (await listReportDates()).filter((d) => d >= minReportDate && d <= asOfDate);
if (dates.length === 0) {
  console.log(JSON.stringify({ stage: "setup-review", asOfDate, status: "no_reports" }, null, 2));
  process.exit(0);
}

await mkdir(getSetupReviewsDir(), { recursive: true });

const rawBarsCache = new Map<string, MarketBar[] | null>();

const processedDates: Array<{ date: string; setups: number; written: number; skippedClosed: number; mdx: string }> = [];

for (const date of dates) {
  const report = await readJson<MarketReport>(getReportJsonPath(date));
  const setups = toSetupSpecs(report);

  let written = 0;
  let skippedClosed = 0;
  let openCount = 0;

  for (const setup of setups) {
    const closedPath = getSetupReviewClosedPerformancePath(setup.setupDate, setup.symbol);
    if (!force && (await fileExists(closedPath))) {
      skippedClosed += 1;
      continue;
    }

    const cacheKey = setup.symbol;
    let bars = rawBarsCache.get(cacheKey);
    if (bars === undefined) {
      const raw = await loadRawSeriesWindow(asOfDate, setup.symbol, "5m");
      bars = raw.status === "ok" ? raw.series.bars : null;
      rawBarsCache.set(cacheKey, bars);
    }

    if (!bars) {
      continue;
    }

    const perf = buildSetupReviewPerformance({
      setupDate: setup.setupDate,
      symbol: setup.symbol,
      setupType: setup.setupType,
      trade: setup.trade,
      bars,
      asOfDate
    });

    await writeSetupReviewPerformance(perf);
    written += 1;
    if (perf.status === "open") {
      openCount += 1;
    }
  }

  const mdxPath = getSetupReviewMdxPath(date);
  if (openCount > 0) {
    const mdx = `# Setup reviews: ${date}\n\n<SetupReviewDay date="${date}" />\n`;
    await mkdir(path.dirname(mdxPath), { recursive: true });
    await writeFile(mdxPath, mdx, "utf8");
  } else {
    await rm(mdxPath, { force: true });
  }

  processedDates.push({
    date,
    setups: setups.length,
    written,
    skippedClosed,
    mdx: openCount > 0 ? "written" : "removed"
  });
}

console.log(
  JSON.stringify(
    {
      stage: "setup-review",
      asOfDate,
      minReportDate,
      reports: dates.length,
      processedDates
    },
    null,
    2
  )
);
