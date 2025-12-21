import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { MarketInterval } from "./types";
import { MARKET_INTERVALS } from "./types";

export type IndicatorDefinition =
  | { id: string; type: "sma"; period: number; source: "close" }
  | { id: string; type: "ema"; period: number; source: "close" }
  | { id: string; type: "rsi"; period: number; source: "close" }
  | {
      id: string;
      type: "macd";
      fastPeriod: number;
      slowPeriod: number;
      signalPeriod: number;
      source: "close";
    };

export type SignalDefinition =
  | {
      id: string;
      label: string;
      when: { indicator: string; op: "lt" | "gt"; value: number };
    }
  | {
      id: string;
      label: string;
      when: { indicator: string; op: "crossAbove" | "crossBelow"; left: string; right: string };
    };

export type AnalysisConfig = {
  intervals: MarketInterval[];
  indicators: IndicatorDefinition[];
  signals: SignalDefinition[];
};

function assertInterval(value: string): MarketInterval {
  if ((MARKET_INTERVALS as readonly string[]).includes(value)) {
    return value as MarketInterval;
  }
  throw new Error(`Unknown interval in config: ${value}`);
}

export async function loadSymbols(rootDir = process.cwd()): Promise<string[]> {
  const raw = await readFile(path.join(rootDir, "config", "symbols.json"), "utf8");
  const json = JSON.parse(raw) as { symbols?: unknown };
  if (!Array.isArray(json.symbols) || !json.symbols.every((s) => typeof s === "string")) {
    throw new Error("config/symbols.json must contain { symbols: string[] }");
  }

  return json.symbols;
}

export async function loadAnalysisConfig(rootDir = process.cwd()): Promise<AnalysisConfig> {
  const raw = await readFile(path.join(rootDir, "config", "analysis.yml"), "utf8");
  const cfg = parseYaml(raw) as Partial<AnalysisConfig>;

  if (!Array.isArray(cfg.intervals) || !cfg.intervals.every((i) => typeof i === "string")) {
    throw new Error("analysis.yml must define intervals: string[]");
  }
  if (!Array.isArray(cfg.indicators) || cfg.indicators.length === 0) {
    throw new Error("analysis.yml must define indicators");
  }
  if (!Array.isArray(cfg.signals)) {
    throw new Error("analysis.yml must define signals");
  }

  return {
    intervals: cfg.intervals.map(assertInterval),
    indicators: cfg.indicators as IndicatorDefinition[],
    signals: cfg.signals as SignalDefinition[]
  };
}
