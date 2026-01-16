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

function almostEqual(a: number, b: number, relEps = 1e-4, absEps = 1e-2): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }

  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff <= Math.max(absEps, scale * relEps);
}

function tradePlansEqual(a: TradePlan, b: TradePlan): boolean {
  if (a.side !== b.side) {
    return false;
  }

  if (!almostEqual(a.entry, b.entry) || !almostEqual(a.stop, b.stop)) {
    return false;
  }

  if (a.targets.length !== b.targets.length) {
    return false;
  }

  // Targets are ordered (tp1, tp2).
  for (let i = 0; i < a.targets.length; i += 1) {
    if (!almostEqual(a.targets[i], b.targets[i])) {
      return false;
    }
  }

  return true;
}

function toSetupSpecs(
  report: MarketReport,
  opts: { onTradeMismatch: (args: { date: string; symbol: string }) => void }
): SetupSpec[] {
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

    // Invariant: if a symbol is both a pick and a watchlist item for a given date,
    // it should have a consistent trade plan across both.
    if (pick && watch && !tradePlansEqual(pick.trade, watch.trade)) {
      opts.onTradeMismatch({ date: report.date, symbol });
      console.warn(
        JSON.stringify(
          {
            stage: "setup-review",
            kind: "trade_mismatch",
            date: report.date,
            symbol,
            picked: "pick",
            pickTrade: pick.trade,
            watchTrade: watch.trade
          },
          null,
          2
        )
      );
    }

    const setup = pick ?? watch;
    if (!setup) {
      continue;
    }

    const setupType: SetupReviewSetupType = pick && watch ? "both" : pick ? "pick" : "watchlist";
    setups.push({ setupDate: report.date, symbol, setupType, trade: setup.trade });
  }

  return setups.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function main() {
  const argv = process.argv.slice(2);
  const asOfDate = getDateArg(argv);
  const windowDays = Number(getArg(argv, "windowDays") ?? 40);
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new Error(`Invalid --windowDays: ${String(getArg(argv, "windowDays"))}`);
  }

  const strictTradeMismatch = process.env.SETUP_REVIEW_STRICT_MISMATCH === "true";
  let hadTradeMismatch = false;
  const tradeMismatchDetails: Array<{ date: string; symbol: string }> = [];

  const force = argv.includes("--force") || getArg(argv, "force") === "true";

  const minReportDate = addDaysIso(asOfDate, -windowDays);

  const dates = (await listReportDates()).filter((d) => d >= minReportDate && d <= asOfDate);
  if (dates.length === 0) {
    console.log(JSON.stringify({ stage: "setup-review", asOfDate, status: "no_reports" }, null, 2));
    process.exit(0);
  }

  await mkdir(getSetupReviewsDir(), { recursive: true });

  const setupsByDate = await Promise.all(
    dates.map(async (date) => {
      const report = await readJson<MarketReport>(getReportJsonPath(date));
      const setups = toSetupSpecs(report, {
        onTradeMismatch: (args) => {
          hadTradeMismatch = true;
          tradeMismatchDetails.push(args);
        }
      });

      return { date, setups };
    })
  );

  if (strictTradeMismatch && hadTradeMismatch) {
    console.log(
      JSON.stringify(
        {
          stage: "setup-review",
          asOfDate,
          minReportDate,
          reports: dates.length,
          tradeMismatch: true,
          tradeMismatchDetails,
          status: "trade_mismatch"
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  const rawBarsCache = new Map<string, MarketBar[] | null>();
  const missingBarsDetails: Array<{ date: string; symbol: string }> = [];

  const processedDates: Array<{ date: string; setups: number; written: number; skippedClosed: number; mdx: string }> = [];

  for (const entry of setupsByDate) {
    const date = entry.date;
    const setups = entry.setups;
    if (setups.length === 0) {
      continue;
    }

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
        missingBarsDetails.push({ date, symbol: setup.symbol });
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
        processedDates,
        tradeMismatch: hadTradeMismatch,
        tradeMismatchDetails,
        missingBars: missingBarsDetails.length,
        missingBarsPreview: missingBarsDetails.slice(0, 20)
      },
      null,
      2
    )
  );

  return;
}

await main();
