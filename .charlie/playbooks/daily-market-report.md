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
