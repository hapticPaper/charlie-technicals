import { getDateArg } from "./lib/args";
import { loadAnalysisConfig, loadSymbols } from "../src/market/config";
import { runMarketReport } from "../src/market/pipeline";

const date = getDateArg(process.argv.slice(2));
const cfg = await loadAnalysisConfig();
const symbols = await loadSymbols();

const res = await runMarketReport({ date, symbols, intervals: cfg.intervals, missingSymbols: [] });
console.log(JSON.stringify({ stage: "report", date, ...res }, null, 2));
