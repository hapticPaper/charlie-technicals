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

function assertPositiveInteger(value: unknown, name: string): number {
  const n = assertNumber(value, name);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got ${n}`);
  }
  return n;
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
      period: assertPositiveInteger(raw.period, `indicator.${id}.period`)
    };
  }

  if (type === "macd") {
    const fastPeriod = assertPositiveInteger(raw.fastPeriod, `indicator.${id}.fastPeriod`);
    const slowPeriod = assertPositiveInteger(raw.slowPeriod, `indicator.${id}.slowPeriod`);
    const signalPeriod = assertPositiveInteger(raw.signalPeriod, `indicator.${id}.signalPeriod`);
    if (fastPeriod >= slowPeriod) {
      throw new Error(`indicator.${id}.fastPeriod must be < slowPeriod`);
    }

    return {
      id,
      type,
      source: "close",
      fastPeriod,
      slowPeriod,
      signalPeriod
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

  const indicators = cfg.indicators.map(validateIndicator);
  const indicatorById = new Map<string, IndicatorDefinition>();
  for (const ind of indicators) {
    if (indicatorById.has(ind.id)) {
      throw new Error(`Duplicate indicator id in analysis.yml: ${ind.id}`);
    }
    indicatorById.set(ind.id, ind);
  }

  for (const required of ["sma20", "ema20", "rsi14"] as const) {
    if (!indicatorById.has(required)) {
      throw new Error(`analysis.yml must define indicator id: ${required}`);
    }
  }

  const signals: SignalDefinition[] = [];
  const signalIds = new Set<string>();
  for (const rawSignal of cfg.signals) {
    const signal = validateSignal(rawSignal);
    if (signalIds.has(signal.id)) {
      throw new Error(`Duplicate signal id in analysis.yml: ${signal.id}`);
    }
    signalIds.add(signal.id);

    const indicator = indicatorById.get(signal.when.indicator);
    if (!indicator) {
      throw new Error(
        `signal.${signal.id}.when.indicator references unknown indicator: ${signal.when.indicator}`
      );
    }

    if ((signal.when.op === "crossAbove" || signal.when.op === "crossBelow") && indicator.type !== "macd") {
      throw new Error(`signal.${signal.id} uses ${signal.when.op} but indicator ${indicator.id} is not macd`);
    }

    signals.push(signal);
  }

  return {
    intervals: cfg.intervals.map(assertInterval),
    indicators,
    signals
  };
}
