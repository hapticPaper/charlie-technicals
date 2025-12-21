# charlie-technicals

Market technicals pipeline (data → analysis → report) driven by Charlie playbooks.

## Local usage

```bash
bun install

# Generate today's report (America/New_York date)
bun run market:run

# Or generate a specific date label
bun run market:run --date=2025-12-21

# View the site
bun run dev
```

Generated artifacts are written under `content/`:

- `content/data/<date>/...`: raw OHLCV per symbol/interval (gitignored)
- `content/analysis/<date>/...`: indicators + signals per symbol/interval (gitignored)
- `content/reports/<date>.json`: aggregated report object (committed)
- `content/reports/<date>.mdx`: MDX that renders charts + summaries (committed)

## Configuration

- Symbol universe: `config/symbols.json`
- Human-readable analysis rules: `config/analysis.yml`

