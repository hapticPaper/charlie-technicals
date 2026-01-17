"use client";

import { useEffect, useState } from "react";

type ThemeName = "light" | "dark";

const STORAGE_KEY = "rp-theme";

function mediaPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getEffectiveTheme(): ThemeName {
  if (typeof document === "undefined") {
    return "light";
  }

  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") {
    return attr;
  }
  return mediaPrefersDark() ? "dark" : "light";
}

function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;

  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage write failures.
  }
}

function Icon(props: { name: ThemeName }) {
  const stroke = "currentColor";
  const common = {
    fill: "none",
    stroke,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  if (props.name === "dark") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          {...common}
          d="M21 13.2A8.2 8.2 0 1 1 10.8 3a6.4 6.4 0 0 0 10.2 10.2Z"
        />
      </svg>
    );
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle {...common} cx="12" cy="12" r="4.5" />
      <path
        {...common}
        d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setThemeState] = useState<ThemeName | null>(null);

  useEffect(() => {
    setThemeState(getEffectiveTheme());

    if (!window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (_event: MediaQueryListEvent) => {
      if (document.documentElement.dataset.theme) {
        return;
      }
      setThemeState(getEffectiveTheme());
    };

    if (media.addEventListener) {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener?.(onChange);
    return () => media.removeListener?.(onChange);
  }, []);

  const label = theme === "dark" ? "Switch to light mode" : theme === "light" ? "Switch to dark mode" : "Toggle theme";

  return (
    <button
      type="button"
      className="rpToolbarButton rpIconButton"
      aria-label={label}
      title={label}
      onClick={() => {
        const current = theme ?? getEffectiveTheme();
        const updated = current === "dark" ? "light" : "dark";
        applyTheme(updated);
        setThemeState(updated);
      }}
    >
      {theme ? <Icon name={theme === "dark" ? "light" : "dark"} /> : null}
    </button>
  );
}
