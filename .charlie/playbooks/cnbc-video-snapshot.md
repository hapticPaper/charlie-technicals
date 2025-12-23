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
  - Do not modify existing historical snapshot files for past dates unless you are explicitly regenerating a known-bad snapshot (e.g. a parsing bug).
    In that case, delete the file first and re-run the command for that date, and reference the incident in the PR description.

## Steps

1. Set `<DATE>` to today in `America/New_York` (YYYY-MM-DD), unless the issue asks for a specific date.
2. Run:

   ```bash
   bun install
   bun run market:cnbc --date=<DATE>
   ```

3. Confirm the file exists: `content/data/cnbc/news/<YYYYMMDD>.json`.

4. Enrich the snapshot by reading headlines and doing the dimensionality reduction:

   - For each saved video, read `title` and set:
     - `topic` to a short, low-dimensional theme (avoid show/segment names).
     - `relatedTickers` to the tickers you are confident the video is primarily about.
     - `symbol` to the primary ticker when exactly one is clearly implied; otherwise `null`.
   - Prefer leaving `topic`, `relatedTickers`, and `symbol` empty over adding false positives.
   - Normalize tickers to uppercase.

## Notes

- The folder name `cnbc` is the data namespace (provider), not a ticker symbol.
- Within each saved video object:
  - `topic` is best-effort and should reflect what the video is about (not the show/segment name).
  - `symbol` is best-effort and should be the primary ticker symbol when one can be inferred (otherwise `null`).
  - If both a specific ticker and a broader theme are present, prefer the ticker for `symbol` and capture the theme in `topic`.

## Verify

- `content/data/cnbc/news/<YYYYMMDD>.json` exists.

## Rollback

- Delete `content/data/cnbc/news/<YYYYMMDD>.json` if you want to discard the fetched snapshot.
