# Daily market report (data → analysis → MDX)

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
  - `content/reports/**`
- Guardrails:
  - Do not modify existing report files for previous dates.
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
   # Runs data → analysis → report for the given date
   bun run market:run --date=<DATE>
   ```

3. Confirm these files exist:
   - `content/reports/<DATE>.mdx`
   - `content/reports/<DATE>.json`
4. Create a PR containing only `content/reports/<DATE>.mdx` and `content/reports/<DATE>.json`.

## Verify

- Run `bun run build` to ensure the site still renders the new MDX.

## Rollback

- Close the PR.
