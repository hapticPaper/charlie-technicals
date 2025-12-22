import { getDateArg } from "./lib/args";

import { runMarketCnbcVideos } from "../src/market/pipeline";

async function main() {
  const date = getDateArg(process.argv.slice(2));
  const res = await runMarketCnbcVideos(date);
  console.log(res);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
