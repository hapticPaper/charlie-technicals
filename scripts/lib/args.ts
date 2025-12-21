import { assertYYYYMMDD, getTodayNYDateString } from "../../src/lib/date";

export function getArg(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of argv) {
    if (a.startsWith(prefix)) {
      return a.slice(prefix.length);
    }
  }
  return undefined;
}

export function getDateArg(argv: string[]): string {
  const date = getArg(argv, "date") ?? getTodayNYDateString();
  assertYYYYMMDD(date);
  return date;
}
