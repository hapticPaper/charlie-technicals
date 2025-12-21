import { getDateArg } from "./lib/args";
import { runMarketAll } from "../src/market/pipeline";

const date = getDateArg(process.argv.slice(2));
const res = await runMarketAll(date);
console.log(JSON.stringify({ stage: "all", date, ...res }, null, 2));
