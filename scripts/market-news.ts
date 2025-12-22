import { getArg, getDateArg } from "./lib/args";
import { runMarketNews } from "../src/market/pipeline";

const argv = process.argv.slice(2);
const date = getDateArg(argv);

const concurrencyRaw = getArg(argv, "concurrency");
let concurrency: number | undefined;
if (concurrencyRaw) {
  const parsed = Number.parseInt(concurrencyRaw, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--concurrency must be a positive integer, got '${concurrencyRaw}'`);
  }
  concurrency = parsed;
}

const res = await runMarketNews(date, { concurrency });
console.log(JSON.stringify({ stage: "news", date, ...res }, null, 2));
