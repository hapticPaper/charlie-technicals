import { getDateArg } from "./lib/args";
import { runMarketAnalyze } from "../src/market/pipeline";

const date = getDateArg(process.argv.slice(2));
const res = await runMarketAnalyze(date);
console.log(JSON.stringify({ stage: "analyze", date, ...res }, null, 2));
