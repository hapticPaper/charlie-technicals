import { getDateArg } from "./lib/args";
import { runMarketData } from "../src/market/pipeline";

const date = getDateArg(process.argv.slice(2));
const res = await runMarketData(date);
console.log(JSON.stringify({ stage: "data", date, ...res }, null, 2));
