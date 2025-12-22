import type { MarketInterval } from "./types";

// Raw data snapshots are stored under:
//   content/data/<SYMBOL>/<INTERVAL>/<YYYYMMDD>.json
//
// Each file is a snapshot for a given "run date" and may contain a rolling lookback window
// (not just that day's bars). The analysis stage treats this layout as the source of truth
// and loads a window of snapshots via `rawDataWindowRequirementFor(interval)`.

export type RawDataWindowRequirement = {
  minFiles: number;
  idealFiles: number;
};

export function formatRawDataFileDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date}. Expected YYYY-MM-DD.`);
  }

  return date.replace(/-/g, "");
}

export function rawDataWindowRequirementFor(interval: MarketInterval): RawDataWindowRequirement {
  // The raw data snapshot for a given date already includes the necessary history for
  // analysis + charting (via provider lookback windows).
  //
  // This mapping exists so the analysis stage can stay declarative ("read last N files")
  // even if we later shard raw data differently by interval.
  switch (interval) {
    case "1m":
    case "5m":
    case "15m":
    case "1h":
    case "1d":
      return { minFiles: 1, idealFiles: 1 };
  }
}
