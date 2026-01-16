# Setup review (open/closed performance tracking)

## Overview
Track the performance of daily trade setups and persist the results under `content/setup_reviews/`.

This is intended to answer: were the daily setups good?

Each setup can only be in one of these states:

- Not opened (entry never hit within the first 5 market sessions)
- Open (entry hit; neither stop nor TP2 has finalized the remaining position)
- Closed (stop hit, or TP2 hit)

## Assumptions (required)

- Market hours only: 9:30–16:00 America/New_York (close is exclusive; `[09:30, 16:00)`).
- The trade only exists if the entry price is hit.
  - If price hits TP1/TP2 before the entry price is ever hit, we treat the trade as not opened.
- The first event is traded (entry → TP/SL sequencing is evaluated from intraday bars).
- The setup day session is included (a setup can open on the same date it was published).
- Setups are assumed to be published before the market open (no intraday publication cutoff).
- Intrabar sequencing is approximated from OHLC bars using a candle-path heuristic:
  - green bar: `open→high→low→close`
  - red bar: `open→low→high→close`
- Exits:
  - 50% at TP1 and the remaining 50% at TP2, or
  - 100% at the stop.
- After 5 market sessions without an entry fill, the setup is marked `not_opened` and is treated as closed.

Implementation notes:

- Uses 5m bars from the raw snapshots under `content/data/<SYMBOL>/5m/<YYYYMMDD>.json`.
- Produces one JSON file per (setup date, symbol) under:
  - `content/setup_reviews/<YYYYMMDD>/<SYMBOL>/open_performance.json`
  - `content/setup_reviews/<YYYYMMDD>/<SYMBOL>/closed_performance.json`
- Writes a secondary MDX file per setup date when (and only when) open positions exist:
  - `content/setup_reviews/<YYYY-MM-DD>.mdx`

## Creates

None automatically.

If the generated `content/setup_reviews/**` artifacts are useful, commit them and open a PR.

## Prerequisites

- Capabilities: GitHub + Devbox
- Tooling: Bun
- Input data: daily reports under `content/reports/<YYYY-MM-DD>.json` and raw 5m snapshots under `content/data/**/5m/<YYYYMMDD>.json`.

## Steps

1. Set `<DATE>` to today in `America/New_York` (YYYY-MM-DD).
2. Run:

   ```bash
   bun install
   bun run market:setup-review --date=<DATE>
   ```

   Optional: widen/narrow the report scan window (calendar days):

   ```bash
   bun run market:setup-review --date=<DATE> --windowDays=40
   ```

3. View results:

   - Portfolio: `/portfolio`
   - Per-day open position page (only exists when there are open positions): `/setup-reviews/<DATE>`

## Verify

- New files exist under `content/setup_reviews/<YYYYMMDD>/`.
- A setup that is still open has an `open_performance.json`.
- A setup that is closed has a `closed_performance.json`.
- Portfolio table renders without errors.
