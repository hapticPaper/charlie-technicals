import { getArg, getDateArg } from "./lib/args";
import { runMarketNews } from "../src/market/pipeline";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 32;

const argv = process.argv.slice(2);
const date = getDateArg(argv);

const concurrencyRaw = getArg(argv, "concurrency");
let concurrency = DEFAULT_CONCURRENCY;
if (concurrencyRaw) {
  const parsed = Number.parseInt(concurrencyRaw, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_CONCURRENCY) {
    throw new Error(
      `--concurrency must be a positive integer ≤ ${MAX_CONCURRENCY}, got '${concurrencyRaw}'`
    );
  }
  concurrency = parsed;
}

const res = await runMarketNews(date, { concurrency });
console.log(JSON.stringify({ stage: "news", date, concurrency, ...res }, null, 2));
