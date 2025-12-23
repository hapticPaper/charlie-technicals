# Market news snapshot (Yahoo)

## Overview
Fetch Yahoo news snapshots for the configured symbol universe and write them under `content/data/<SYMBOL>/news/<YYYYMMDD>.json`.

Note: this is also run as part of `bun run market:data` (the full acquisition stage).

## Creates

None. This playbook writes local artifacts under `content/data/` for downstream analysis.

## Prerequisites

- Capabilities: GitHub + Devbox
- Tooling: Bun

## Limits

- Guardrails:
  - Historical snapshots are treated as immutable.
  - For today's date (America/New_York), reruns merge into existing snapshots so late articles can be picked up without losing prior topic/ticker enrichment.

## Steps

1. Set `<DATE>` to today in `America/New_York` (YYYY-MM-DD), unless the issue asks for a specific date.
2. Run:

   ```bash
   bun install
   bun run market:news --date=<DATE>
   ```

   Optional: tune concurrency (use low values if Yahoo is rate-limiting):

   ```bash
   bun run market:news --date=<DATE> --concurrency=1
   ```

3. Confirm the new files exist:

   - `content/data/<SYMBOL>/news/<YYYYMMDD>.json`

## Verify

- Spot-check that `content/data/SPY/news/<YYYYMMDD>.json` exists.

## Rollback

- Delete the `content/data/<SYMBOL>/news/<YYYYMMDD>.json` files if you want to discard the fetched snapshots.
