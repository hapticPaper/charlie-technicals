# Market analysis run (indicators + signals)

## Overview
Compute indicators and signal hits from `content/data/<date>/...` and write the results under `content/analysis/<date>/`.

## Creates

None. This playbook writes local artifacts under `content/analysis/<DATE>/`.

## Prerequisites

- Capabilities: GitHub + Devbox
- Data: `content/data/<DATE>/` already exists

## Limits

- Guardrails:
  - Do not edit config/rules in the same run.

## Steps

1. Set `<DATE>` to the date folder you want to analyze.
2. Run:

   ```bash
   bun install
   bun run market:analyze --date=<DATE>
   ```

3. Confirm the new folder exists: `content/analysis/<DATE>/`.
4. Do not open a PR (these are intermediate artifacts).

## Verify

- `content/analysis/<DATE>/` exists and contains one `.json` per symbol+interval.

## Rollback

- Close the PR.
