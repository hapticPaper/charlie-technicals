import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";

import { formatRawDataFileDate, rawDataWindowRequirementFor } from "./dataConventions";
import { withFileLock } from "./fileLock";
import { fileExists } from "./fsUtils";
import type { ExistingSnapshotMode } from "./snapshotTypes";
import { getDataDir, readJson, writeJson } from "./storage";
import type { MarketInterval, RawSeries } from "./types";

// Canonical read/write helpers for raw OHLCV snapshots under:
//   content/data/<SYMBOL>/<INTERVAL>/<YYYYMMDD>.json

function safeSymbol(symbol: string): string {
  return encodeURIComponent(symbol);
}

export function getRawSeriesDir(symbol: string, interval: MarketInterval): string {
  return path.join(getDataDir(), safeSymbol(symbol), interval);
}

export function getRawSeriesPath(date: string, symbol: string, interval: MarketInterval): string {
  const fileDate = formatRawDataFileDate(date);
  return path.join(getRawSeriesDir(symbol, interval), `${fileDate}.json`);
}

export async function rawSeriesSnapshotExists(
  date: string,
  symbol: string,
  interval: MarketInterval
): Promise<boolean> {
  return fileExists(getRawSeriesPath(date, symbol, interval));
}

function mergeBarsPreferSecond(
  baseBars: RawSeries["bars"],
  preferredBars: RawSeries["bars"]
): RawSeries["bars"] {
  // Merge + dedupe bars by timestamp.
  //
  // Contract:
  // - Output is sorted by `t`.
  // - Duplicate timestamps are resolved by preferring `preferredBars` values.
  // `t` must be ISO-8601 so `localeCompare` keeps chronological ordering.
  const ensureSorted = (bars: RawSeries["bars"], label: string): RawSeries["bars"] => {
    for (let idx = 1; idx < bars.length; idx += 1) {
      if (bars[idx - 1].t.localeCompare(bars[idx].t) > 0) {
        console.error(
          `[market:rawSeriesStorage] Non-monotonic bar timestamps detected in ${label}; sorting before merge`
        );
        return [...bars].sort((a, b) => a.t.localeCompare(b.t));
      }
    }

    return bars;
  };

  const left = ensureSorted(baseBars, "baseBars");
  const right = ensureSorted(preferredBars, "preferredBars");

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

function mergeIncomingWithPersisted(
  incomingBars: RawSeries["bars"],
  persistedBars: RawSeries["bars"]
): RawSeries["bars"] {
  return mergeBarsPreferSecond(incomingBars, persistedBars);
}

function mergeEarlierWithLater(
  earlierBars: RawSeries["bars"],
  laterBars: RawSeries["bars"]
): RawSeries["bars"] {
  return mergeBarsPreferSecond(earlierBars, laterBars);
}

export type WriteRawSeriesResult =
  | { status: "written"; path: string }
  | { status: "skipped_existing"; path: string };

/**
* Writes a raw OHLCV snapshot for a given symbol/interval/date.
*
* Raw snapshots are immutable by default: if the target file already exists, the
* write is skipped and the existing snapshot is left untouched.
*
* When `mode: "fill_existing"` is used, the write merges the incoming bars into
* the existing file, adding only new timestamps.
*/
export async function writeRawSeries(
  date: string,
  series: RawSeries,
  opts: {
    mode?: ExistingSnapshotMode;
  } = {}
): Promise<WriteRawSeriesResult> {
  const filePath = getRawSeriesPath(date, series.symbol, series.interval);
  const tmpPath = `${filePath}.tmp`;

  await mkdir(path.dirname(filePath), { recursive: true });

  const res = await withFileLock({ filePath, logPrefix: "market:rawSeriesStorage" }, async () => {
    if (await fileExists(filePath)) {
      if (opts.mode !== "fill_existing") {
        return { status: "skipped_existing" as const, path: filePath };
      }

      const existing = await readJson<RawSeries>(filePath);
      if (existing.symbol !== series.symbol || existing.interval !== series.interval) {
        throw new Error(
          `[market:rawSeriesStorage] Raw series metadata mismatch in ${filePath}: expected ${series.symbol}/${series.interval}, got ${existing.symbol}/${existing.interval}`
        );
      }

      if (existing.provider !== series.provider) {
        // We expect a single provider per (symbol, interval) on disk.
        // If we intentionally change providers, delete old snapshots or migrate them.
        throw new Error(
          `[market:rawSeriesStorage] Raw series provider mismatch in ${filePath}: ${existing.provider} vs ${series.provider}. To change providers, delete existing snapshots or migrate them first.`
        );
      }

      // Preserve persisted bars on conflicts; only add missing timestamps.
      const mergedBars = mergeIncomingWithPersisted(series.bars, existing.bars);
      const isSameLength = mergedBars.length === existing.bars.length;
      const barsUnchanged =
        isSameLength &&
        mergedBars.every((b, idx) => {
          const prev = existing.bars[idx];
          return (
            prev !== undefined &&
            prev.t === b.t &&
            prev.o === b.o &&
            prev.h === b.h &&
            prev.l === b.l &&
            prev.c === b.c &&
            prev.v === b.v
          );
        });

      if (barsUnchanged) {
        return { status: "skipped_existing" as const, path: filePath };
      }

      const merged: RawSeries = {
        ...existing,
        fetchedAt:
          existing.fetchedAt.localeCompare(series.fetchedAt) >= 0
            ? existing.fetchedAt
            : series.fetchedAt,
        bars: mergedBars
      };

      await writeJson(tmpPath, merged);
      await rename(tmpPath, filePath);
      return { status: "written" as const, path: filePath };
    }

    await writeJson(tmpPath, series);
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

  let provider: RawSeries["provider"] | null = null;
  let fetchedAt = "";
  let bars: RawSeries["bars"] = [];
  for (const fileDate of selected) {
    const raw = await readJson<RawSeries>(path.join(dir, `${fileDate}.json`));

    if (raw.symbol !== symbol || raw.interval !== interval) {
      throw new Error(
        `[market:rawSeriesStorage] Mismatched series metadata in ${symbol}/${interval} ${fileDate}: expected ${symbol}/${interval}, got ${raw.symbol}/${raw.interval}`
      );
    }

    if (provider !== null && provider !== raw.provider) {
      // We expect a single provider per (symbol, interval) on disk.
      // If we intentionally change providers, delete old snapshots or migrate them.
      // Fail fast to avoid silently mixing bars across providers.
      throw new Error(
        `[market:rawSeriesStorage] Multiple providers for ${symbol} ${interval}: ${provider} and ${raw.provider}. To change providers, delete existing snapshots or migrate them first.`
      );
    }

    provider = raw.provider;
    // ISO strings preserve chronological ordering under lexicographic compare.
    fetchedAt =
      fetchedAt === "" ? raw.fetchedAt : fetchedAt.localeCompare(raw.fetchedAt) >= 0 ? fetchedAt : raw.fetchedAt;
    bars = mergeEarlierWithLater(bars, raw.bars);
  }

  if (provider === null) {
    throw new Error(`[market:rawSeriesStorage] Missing provider for ${symbol} ${interval} at ${date}`);
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
