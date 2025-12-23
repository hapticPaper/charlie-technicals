# Market acquisition snapshot (OHLCV + news + CNBC)

## Overview
Fetch the daily acquisition snapshot (raw OHLCV bars + Yahoo news + CNBC videos) and write the results under `content/data/`.

## Creates

None. This playbook writes local artifacts under `content/data/` for downstream analysis.

## Prerequisites

- Capabilities: GitHub + Devbox
- Tooling: Bun

## Limits

- Guardrails:
  - Historical snapshots are treated as immutable.
  - For today's date (America/New_York), reruns merge into existing snapshots to fill gaps and pick up late updates.
  - When doing a full daily workflow, use the same `<DATE>` across acquisition, analysis, and report steps. Avoid interleaving runs for different dates in one branch.

## Steps

1. Set `<DATE>` to today in `America/New_York` (YYYY-MM-DD), unless the issue asks for a specific date.
2. Run:

   ```bash
   bun install
   bun run market:data --date=<DATE>
   ```

3. Confirm the new files exist:

   - Raw OHLCV bars:
     - `content/data/<SYMBOL>/<INTERVAL>/<YYYYMMDD>.json`
   - Yahoo news:
     - `content/data/<SYMBOL>/news/<YYYYMMDD>.json`
   - CNBC videos:
     - `content/data/cnbc/news/<YYYYMMDD>.json`

4. Do not open a PR (these are intermediate artifacts).

   If you're doing a full daily run, the daily report playbook PR should include the new `content/data/**/<YYYYMMDD>.json` snapshots for that date.

## Verify

- Spot-check that raw bars + news snapshots exist for a representative symbol:

  - `content/data/SPY/1d/<YYYYMMDD>.json`
  - `content/data/SPY/news/<YYYYMMDD>.json`
  - `content/data/cnbc/news/<YYYYMMDD>.json`

## Rollback

- For today's date (America/New_York), delete the `<YYYYMMDD>.json` snapshots you fetched under:

  - `content/data/<SYMBOL>/<INTERVAL>/`
  - `content/data/<SYMBOL>/news/`
  - `content/data/cnbc/news/`

- For historical dates, do not delete or overwrite existing snapshots unless you are explicitly regenerating a known-bad snapshot (and you should document the incident in the PR description).
