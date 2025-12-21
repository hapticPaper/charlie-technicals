# Market data snapshot (raw OHLCV)

## Overview
Fetch raw OHLCV bars for the configured symbol universe and time windows, and write them under `content/data/<date>/`.

## Creates

None. This playbook writes local artifacts under `content/data/<DATE>/` for downstream analysis.

## Prerequisites

- Capabilities: GitHub + Devbox
- Tooling: Bun

## Limits

- Guardrails:
  - Do not modify existing historical snapshot files for past dates.

## Steps

1. Set `<DATE>` to today in `America/New_York` (YYYY-MM-DD), unless the issue asks for a specific date.
2. Run:

   ```bash
   bun install
   bun run market:data --date=<DATE>
   ```

3. Confirm the new folder exists: `content/data/<DATE>/`.

4. Do not open a PR (these are intermediate artifacts).

## Verify

- `content/data/<DATE>/` exists and contains one `.json` per symbol+interval.

## Rollback

- Close the PR.
