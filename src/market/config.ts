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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function assertNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function validateIndicator(raw: unknown): IndicatorDefinition {
  if (!isRecord(raw)) {
    throw new Error("indicator must be an object");
  }

  const id = assertString(raw.id, "indicator.id");
  const type = assertString(raw.type, "indicator.type");
  const source = assertString(raw.source, "indicator.source");
  if (source !== "close") {
    throw new Error(`Unsupported indicator.source: ${source}`);
  }

  if (type === "sma" || type === "ema" || type === "rsi") {
    return {
      id,
      type,
      source: "close",
      period: assertNumber(raw.period, `indicator.${id}.period`)
    };
  }

  if (type === "macd") {
    return {
      id,
      type,
      source: "close",
      fastPeriod: assertNumber(raw.fastPeriod, `indicator.${id}.fastPeriod`),
      slowPeriod: assertNumber(raw.slowPeriod, `indicator.${id}.slowPeriod`),
      signalPeriod: assertNumber(raw.signalPeriod, `indicator.${id}.signalPeriod`)
    };
  }

  throw new Error(`Unsupported indicator.type: ${type}`);
}

function validateSignal(raw: unknown): SignalDefinition {
  if (!isRecord(raw)) {
    throw new Error("signal must be an object");
  }

  const id = assertString(raw.id, "signal.id");
  const label = assertString(raw.label, "signal.label");
  if (!isRecord(raw.when)) {
    throw new Error(`signal.${id}.when must be an object`);
  }

  const indicator = assertString(raw.when.indicator, `signal.${id}.when.indicator`);
  const op = assertString(raw.when.op, `signal.${id}.when.op`);

  if (op === "lt" || op === "gt") {
    return {
      id,
      label,
      when: {
        indicator,
        op,
        value: assertNumber(raw.when.value, `signal.${id}.when.value`)
      }
    };
  }

  if (op === "crossAbove" || op === "crossBelow") {
    return {
      id,
      label,
      when: {
        indicator,
        op,
        left: assertString(raw.when.left, `signal.${id}.when.left`),
        right: assertString(raw.when.right, `signal.${id}.when.right`)
      }
    };
  }

  throw new Error(`Unsupported signal op: ${op}`);
}

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
    indicators: cfg.indicators.map(validateIndicator),
    signals: cfg.signals.map(validateSignal)
  };
}
