# Daily market report (acquire → analyze → report)

## Overview
Generate a daily MDX report (plus supporting JSON artifacts) for the configured universe and time windows.

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
   # Runs acquire → analyze → report for the given date
   bun run market:run --date=<DATE>
   ```

3. Confirm these files exist:
   - `content/reports/<DATE>.mdx`
   - `content/reports/<DATE>.json`
   - (Optional cache) `content/reports/<DATE>.highlights.json`
4. Create a PR containing:

   - `content/data/**/<YYYYMMDD>.json` snapshots for the run date (OHLCV + news + CNBC)
   - `content/reports/<DATE>.mdx`
   - `content/reports/<DATE>.json`
   - (Optional) `content/reports/<DATE>.highlights.json`

## Verify

- Run `bun run build` to ensure the site still renders the new MDX.

## Rollback

- Close the PR.
