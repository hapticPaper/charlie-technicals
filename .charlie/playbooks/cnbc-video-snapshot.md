# CNBC video snapshot

## Overview
Scrape the CNBC Latest Video feed and write a news snapshot under `content/data/cnbc/news/<YYYYMMDD>.json`.

## Creates

None. This playbook writes local artifacts under `content/data/cnbc/news/`.

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
   bun run market:cnbc --date=<DATE>
   ```

3. Confirm the file exists: `content/data/cnbc/news/<YYYYMMDD>.json`.

## Verify

- `content/data/cnbc/news/<YYYYMMDD>.json` exists.

## Rollback

- Delete `content/data/cnbc/news/<YYYYMMDD>.json` if you want to discard the fetched snapshot.
