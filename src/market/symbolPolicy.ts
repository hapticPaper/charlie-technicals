export const NON_SELECTABLE_SYMBOL_PREFIXES: readonly string[] = ["^"];

export function isNonSelectableSymbol(symbol: string): boolean {
  return NON_SELECTABLE_SYMBOL_PREFIXES.some((prefix) => symbol.startsWith(prefix));
}

export const NEWS_EXCLUDED_SYMBOLS: readonly string[] = ["cnbc"];

export function isNewsEligibleSymbol(symbol: string): boolean {
  if (NEWS_EXCLUDED_SYMBOLS.includes(symbol)) {
    return false;
  }
  return !isNonSelectableSymbol(symbol);
}
