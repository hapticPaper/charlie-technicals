import { assertYYYYMMDD, getTodayNYDateString } from "../../src/lib/date";

export function getArg(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === `--${name}`) {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("--")) {
        throw new Error(`Expected value after --${name}`);
      }

      return next;
    }

    if (a.startsWith(prefix)) {
      return a.slice(prefix.length);
    }
  }
  return undefined;
}

export function getDateArg(argv: string[]): string {
  const date = getArg(argv, "date") ?? getTodayNYDateString();
  assertYYYYMMDD(date);

  const today = getTodayNYDateString();
  if (date > today) {
    throw new Error(`Date cannot be in the future (NY). Got ${date}, today is ${today}`);
  }

  return date;
}
