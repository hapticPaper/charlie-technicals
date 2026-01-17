export const THEME_STORAGE_KEY = "rp-theme" as const;

export const THEME_OVERRIDES = ["light", "dark"] as const;
export type ThemeOverride = (typeof THEME_OVERRIDES)[number];

export type ThemeSetting = ThemeOverride | "system";

export function isThemeOverride(value: unknown): value is ThemeOverride {
  return value === "light" || value === "dark";
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "system" || isThemeOverride(value);
}
