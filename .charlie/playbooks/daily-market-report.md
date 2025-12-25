# Daily market report (acquire → analyze → aggregate → report → summarize → commit)

## Overview
Generate a daily MDX report (plus supporting JSON artifacts) for the configured universe and time windows.

The rendered report is split into:

- Market commentary (1–3 sentences; what matters over the next few sessions)
- Most-active names (dollar volume, within the configured universe)
- Technical trades (signal-based picks that pass the current filters)
- Watchlist commentary + stance (always present, even when there are zero technical trades)
- Technical analysis + visuals (charts) for both technical trades and watchlist names

### Selection rules (current)

- *Technical trades* (`report.picks`): momentum/breakout/levels setups, scored using multi-timeframe momentum (15m/1h/1d), daily breakouts (close above/below prior 20d/55d/252d highs/lows), pivot support/resistance proximity, and a simple supply/demand proxy (range expansion + volume confirmation). If ATR14 is available, names with a sub-1-ATR daily move are filtered out unless they are in a 20d/55d/252d breakout/breakdown.
- *Watchlist* (`report.watchlist`): prioritize liquid (high dollar-volume) names with clear momentum/trend bias and/or an explicit setup that is still sub-ATR on the day. Avoid "random" low-liquidity names unless they're showing a strong trade-quality setup.

### Narrative guidelines (required)

- Always include both:
  - *Market commentary* (what matters over the next few sessions; focus on breadth/volatility/concentration in plain English).
  - *Watchlist commentary* (our stance/bias on the watchlist names; what to watch for next).
- Keep it clean and concise (human-readable).
- Do not dump per-symbol indicator hits (e.g., "AIG: RSI overbought | …") into the narrative; keep that detail on the technical analysis charts/sections.

### Summarize step (required)

The **summarize** step is where we convert the computed `MarketReport` into a small, UI-ready payload that can be embedded into the MDX.

Key intent:

- The MDX should remain **declarative**: it includes *what to render* plus *the data to render it*.
- The MDX should not embed any UI output. It only includes component invocations (e.g. `<ReportSummary ... />`) and props.
- The report page should not need to “re-aggregate” or parse narrative text just to render summary widgets.

#### Summarize step contract

The summarize step MUST take a `MarketReport` and produce a `MarketReportSummaryWidgets` object (see schema below) with these invariants enforced **before** persisting to MDX:

- `narrative.mainIdea` and `narrative.veryShort` come directly from `report.summaries`.
- `sentiment` is `null` unless `report.summaries.sentiment.lines` produces 1–3 non-empty lines after trimming/capping.
- `technicalTrades.total` is `report.picks.length`, and `technicalTrades.preview` is the first `REPORT_MAX_PICKS` entries (no extra UI-side sorting/parsing).
- `watchlist.total` is `report.watchlist.length`, and `watchlist.preview` is the first `REPORT_MAX_WATCHLIST` entries (no extra UI-side sorting/parsing).
- `mostActive` is derived from `report.mostActive.byDollarVolume1d` + `report.mostActive.byDollarVolume5d`.
  - `day.top` + `day.overflow` must preserve rank order and form a single ranked list (overflow is a continuation).
  - `week.top` must preserve rank order.
- `fullContext` comes directly from `report.summaries.summary`.
- Every list item must include a stable `key` (use rank + symbol), so the UI is a pure renderer.

#### `ReportSummary` embedded payload (`MarketReportSummaryWidgets`)

The report generator embeds a precomputed `summary` prop into the MDX:

```mdx
<ReportSummary summary={...} />
```

This `summary` object is a persisted, versioned schema (historical MDX keeps whatever was embedded at generation time). The current schema is:

- `version`: must be `"v1-summary-widgets"`.
- `narrative`:
  - `mainIdea`: the top narrative headline.
  - `veryShort`: ultra-compact summary (<= `REPORT_VERY_SHORT_MAX_WORDS`).
- `sentiment`: `null` or `{ tone, lines }`.
  - `tone`: one of `"risk-on" | "risk-off" | "mixed"`.
  - `lines`: 1–3 bullets, already trimmed/capped.
- `technicalTrades`:
  - `total`: total number of picks.
  - `preview`: up to `REPORT_MAX_PICKS` items, each containing `{ symbol, trade: { side, entry, stop } }`.
  - `hasMore`: whether more than the preview exists.
- `watchlist`:
  - `total`: total number of watchlist names.
  - `preview`: up to `REPORT_MAX_WATCHLIST` items, each containing `{ symbol, trade: { side }, basis, move1dAtr14 }`.
  - `hasMore`: whether more than the preview exists.
- `mostActive`: `null` or `{ day, week }` where:
  - `day.top`: top-ranked (visible) 1d dollar volume rows.
  - `day.overflow`: the remainder as a ranked continuation.
  - `week.top`: top-ranked 5d dollar volume rows.
- `fullContext`: the long-form summary text used by the “Full context” expander.

All list entries include a precomputed `key` field so the UI can render stable lists without recomputing identifiers.

If we change this schema, we must bump `version` and keep the renderer compatible with historical versions.

## Creates

- Artifact: PR
- Title pattern: "Daily market report: <YYYY-MM-DD>"
- Branch: `proactive/market-report-YYYYMMDD`

## Prerequisites

- Capabilities: GitHub + Devbox
- Tooling: Bun

## Limits

- Max artifacts per run: 1 PR
- Allowed paths:
  - `content/data/**` (only new snapshots for the run date)
  - `content/reports/**` (only the run date)
- Guardrails:
  - Previous (non-today) dates are treated as immutable. Don't modify existing `content/data/**/<YYYYMMDD>.json` snapshots or `content/reports/<DATE>.*` for past dates.
  - For today's date (America/New_York), reruns are allowed to pick up late news/videos and fill missing OHLCV timestamps.
  - Do not change `config/**` or any source code in this playbook.
  - Trade ideas / setups should be based on tradeable symbols. Market internals (breadth/volume) and regime indicators (e.g., `^VIX`) can be referenced for context, but shouldn't be the sole basis for a trade.

## No-op when

- `content/reports/<DATE>.mdx` already exists.

## Steps

1. Set `<DATE>` to today in `America/New_York` (YYYY-MM-DD).
2. Run:

   ```bash
   bun --version
   bun install
   # Runs acquire → analyze → aggregate → report → summarize for the given date
   bun run market:run --date=<DATE>
   ```

3. Confirm these files exist:
   - `content/reports/<DATE>.mdx`
   - `content/reports/<DATE>.json`
   - (Optional cache) `content/reports/<DATE>.highlights.json`

   Note: the generated MDX includes a precomputed `ReportSummary` payload so the UI can render the summary widgets without additional client-side aggregation.
4. Create a PR containing:

   - `content/data/**/<YYYYMMDD>.json` snapshots for the run date (OHLCV + news + CNBC)
   - `content/reports/<DATE>.mdx`
   - `content/reports/<DATE>.json`
   - (Optional) `content/reports/<DATE>.highlights.json`

## Verify

- Run `bun run build` to ensure the site still renders the new MDX.

## Rollback

- Close the PR.
