import { getDateArg } from "./lib/args";
import { runMarketNews } from "../src/market/pipeline";

const date = getDateArg(process.argv.slice(2));
const res = await runMarketNews(date);
console.log(JSON.stringify({ stage: "news", date, ...res }, null, 2));
