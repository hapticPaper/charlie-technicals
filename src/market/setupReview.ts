import { SETUP_REVIEW_PERFORMANCE_VERSION } from "./types";
import type {
  MarketBar,
  SetupReviewOutcome,
  SetupReviewPerformance,
  SetupReviewSetupType,
  TradePlan,
  TradeSide
} from "./types";

type TradeEventKind = "entry" | "tp1" | "tp2" | "stop";

const NY_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;

function nyDateAndMinutes(iso: string): { ymd: string; minutes: number } | null {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return null;
  }

  const parts = NY_PARTS.formatToParts(new Date(ts));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;

  if (!year || !month || !day || !hour || !minute) {
    return null;
  }

  const minutes = Number(hour) * 60 + Number(minute);
  if (!Number.isFinite(minutes)) {
    return null;
  }

  return { ymd: `${year}-${month}-${day}`, minutes };
}

function isMarketHours(minutes: number): boolean {
  // 5m bars are timestamped at bar open in NY time.
  // NOTE(v2-setup-performance): Regular session is treated as: [09:30, 16:00).
  return minutes >= MARKET_OPEN_MINUTES && minutes < MARKET_CLOSE_MINUTES;
}

function tradeReturnFraction(side: TradeSide, entry: number, exit: number): number {
  if (!Number.isFinite(entry) || entry === 0) {
    return 0;
  }

  return side === "buy" ? (exit - entry) / entry : (entry - exit) / entry;
}

function pickNextEvent(args: {
  from: number;
  to: number;
  candidates: Array<{ kind: TradeEventKind; price: number }>;
}): { kind: TradeEventKind; price: number } | null {
  const dir = Math.sign(args.to - args.from);

  const order: Record<TradeEventKind, number> = {
    entry: 0,
    tp1: 1,
    tp2: 2,
    stop: 3
  };

  const matches = args.candidates
    .filter((c) => Number.isFinite(c.price))
    .map((c) => {
      if (dir === 0) {
        return c.price === args.from ? { ...c, distance: 0 } : null;
      }

      const min = Math.min(args.from, args.to);
      const max = Math.max(args.from, args.to);
      if (c.price < min || c.price > max) {
        return null;
      }

      const distance = dir > 0 ? c.price - args.from : args.from - c.price;
      return distance >= 0 ? { ...c, distance } : null;
    })
    .filter((c): c is { kind: TradeEventKind; price: number; distance: number } => c !== null);

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }

    return order[a.kind] - order[b.kind];
  });

  const next = matches[0];
  return next ? { kind: next.kind, price: next.price } : null;
}

function applyEvent(args: {
  trade: TradePlan;
  bar: MarketBar;
  event: { kind: TradeEventKind; price: number };
  state: {
    entryAt: string | null;
    tp1At: string | null;
    tp2At: string | null;
    stopAt: string | null;
    realized: number;
    remaining: number;
  };
}): void {
  const { trade, bar, event, state } = args;

  switch (event.kind) {
    case "entry": {
      if (state.entryAt === null) {
        state.entryAt = bar.t;
        state.remaining = 1;
      }
      return;
    }

    case "tp1": {
      const target = trade.targets[0];
      if (typeof target !== "number" || !Number.isFinite(target)) {
        return;
      }

      if (state.tp1At === null) {
        state.tp1At = bar.t;
        state.realized += 0.5 * tradeReturnFraction(trade.side, trade.entry, target);
        state.remaining = Math.max(0, state.remaining - 0.5);
      }

      return;
    }

    case "tp2": {
      const target = trade.targets[1];
      if (typeof target !== "number" || !Number.isFinite(target)) {
        return;
      }

      if (state.tp2At === null) {
        state.tp2At = bar.t;
        state.realized += 0.5 * tradeReturnFraction(trade.side, trade.entry, target);
        state.remaining = 0;
      }

      return;
    }

    case "stop": {
      if (state.stopAt === null) {
        state.stopAt = bar.t;
        state.realized += state.remaining * tradeReturnFraction(trade.side, trade.entry, trade.stop);
        state.remaining = 0;
      }

      return;
    }
  }
}

function simulateTrade(args: {
  setupDate: string;
  asOfDate: string;
  trade: TradePlan;
  bars: MarketBar[];
}): {
  outcome: SetupReviewOutcome;
  entryAt: string | null;
  tp1At: string | null;
  tp2At: string | null;
  stopAt: string | null;
  realizedPct: number;
  unrealizedPct: number | null;
  totalPct: number | null;
  currentPrice: number | null;
} {
  const trade = args.trade;

  const filtered: MarketBar[] = [];
  const seenDays: string[] = [];
  const seenDaySet = new Set<string>();
  for (const bar of args.bars) {
    const meta = nyDateAndMinutes(bar.t);
    if (!meta) {
      continue;
    }

    // NOTE(v2-setup-performance): Assumes setups are published before the NY session open on setupDate.
    // Therefore we treat the entire setupDate regular session as eligible for fills.
    // If you change this behavior, update the setup review playbook, bump SETUP_REVIEW_PERFORMANCE_VERSION,
    // and regenerate stored artifacts.
    if (meta.ymd < args.setupDate || meta.ymd > args.asOfDate) {
      continue;
    }

    if (!isMarketHours(meta.minutes)) {
      continue;
    }

    filtered.push(bar);
    if (!seenDaySet.has(meta.ymd)) {
      seenDaySet.add(meta.ymd);
      seenDays.push(meta.ymd);
    }
  }

  const state = {
    entryAt: null as string | null,
    tp1At: null as string | null,
    tp2At: null as string | null,
    stopAt: null as string | null,
    realized: 0,
    remaining: 0
  };

  for (const bar of filtered) {
    const points =
      bar.c >= bar.o
        ? [bar.o, bar.h, bar.l, bar.c]
        : [bar.o, bar.l, bar.h, bar.c];

    for (let i = 0; i < points.length - 1; i += 1) {
      let curr = points[i];
      const dest = points[i + 1];

      while (true) {
        const candidates: Array<{ kind: TradeEventKind; price: number }> = [];
        if (state.entryAt === null) {
          candidates.push({ kind: "entry", price: trade.entry });
        } else {
          if (state.remaining > 0) {
            candidates.push({ kind: "stop", price: trade.stop });
          }
          if (state.tp1At === null) {
            const tp1 = trade.targets[0];
            if (typeof tp1 === "number" && Number.isFinite(tp1)) {
              candidates.push({ kind: "tp1", price: tp1 });
            }
          } else if (state.tp2At === null) {
            const tp2 = trade.targets[1];
            if (typeof tp2 === "number" && Number.isFinite(tp2)) {
              candidates.push({ kind: "tp2", price: tp2 });
            }
          }
        }

        const next = pickNextEvent({ from: curr, to: dest, candidates });
        if (!next) {
          break;
        }

        applyEvent({ trade, bar, event: next, state });
        curr = next.price;

        if (state.remaining === 0 && state.entryAt !== null) {
          break;
        }
      }

      if (state.remaining === 0 && state.entryAt !== null) {
        break;
      }
    }

    if (state.remaining === 0 && state.entryAt !== null) {
      break;
    }
  }

  const currentPrice = filtered.length > 0 ? filtered[filtered.length - 1]?.c ?? null : null;
  const realizedPct = state.realized * 100;
  const hasEntry = state.entryAt !== null;
  const unrealizedPct =
    hasEntry && state.remaining > 0 && typeof currentPrice === "number" && Number.isFinite(currentPrice)
      ? state.remaining * tradeReturnFraction(trade.side, trade.entry, currentPrice) * 100
      : hasEntry
        ? 0
        : null;
  const totalPct = hasEntry ? realizedPct + (unrealizedPct ?? 0) : null;

  const hasTp1 = state.tp1At !== null;
  const hasTp2 = state.tp2At !== null;
  const hasStop = state.stopAt !== null;

  const outcome: SetupReviewOutcome =
    !hasEntry
      ? seenDays.length >= 5
        ? "not_opened"
        : "pending"
      : hasStop && !hasTp1
        ? "stopped_out"
        : hasTp1 && hasTp2
          ? "tp1_tp2"
          : hasTp1 && hasStop
            ? "tp1_stop"
            : hasTp1
              ? "tp1_open"
              : "open";

  return {
    outcome,
    entryAt: state.entryAt,
    tp1At: state.tp1At,
    tp2At: state.tp2At,
    stopAt: state.stopAt,
    realizedPct,
    unrealizedPct,
    totalPct,
    currentPrice: typeof currentPrice === "number" && Number.isFinite(currentPrice) ? currentPrice : null
  };
}

export function buildSetupReviewPerformance(args: {
  setupDate: string;
  symbol: string;
  setupType: SetupReviewSetupType;
  trade: TradePlan;
  bars: MarketBar[];
  asOfDate: string;
  now?: Date;
}): SetupReviewPerformance {
  const computedAt = (args.now ?? new Date()).toISOString();
  const sim = simulateTrade({
    setupDate: args.setupDate,
    asOfDate: args.asOfDate,
    trade: args.trade,
    bars: args.bars
  });

  const status: SetupReviewPerformance["status"] =
    sim.outcome === "not_opened" || sim.outcome === "stopped_out" || sim.outcome === "tp1_stop" || sim.outcome === "tp1_tp2"
      ? "closed"
      : "open";

  const totalPct = status === "closed" ? sim.realizedPct : sim.totalPct;
  const unrealizedPct = status === "closed" ? null : sim.unrealizedPct;

  return {
    version: SETUP_REVIEW_PERFORMANCE_VERSION,
    setupDate: args.setupDate,
    symbol: args.symbol,
    setupType: args.setupType,
    trade: args.trade,
    asOfDate: args.asOfDate,
    computedAt,
    openedAt: sim.entryAt,
    tp1At: sim.tp1At,
    tp2At: sim.tp2At,
    stopAt: sim.stopAt,
    currentPrice: sim.currentPrice,
    realizedPct: sim.realizedPct,
    unrealizedPct,
    totalPct,
    status,
    outcome: sim.outcome
  };
}
