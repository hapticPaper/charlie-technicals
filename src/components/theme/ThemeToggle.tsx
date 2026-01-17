"use client";

import { useEffect, useState } from "react";

import {
  THEME_STORAGE_KEY,
  isThemeSetting,
  type ThemeSetting
} from "./themeConstants";

function getStoredSetting(): ThemeSetting {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeSetting(value)) {
      return value;
    }

    if (value) {
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // Ignore storage read failures.
  }

  return "system";
}

function applySetting(setting: ThemeSetting) {
  if (typeof document === "undefined") {
    return;
  }

  if (setting === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = setting;
  }

  try {
    if (setting === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, setting);
    }
  } catch {
    // Ignore storage write failures.
  }
}

function Icon(props: { name: ThemeSetting }) {
  const stroke = "currentColor";
  const common = {
    fill: "none",
    stroke,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  if (props.name === "system") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <rect {...common} x="4" y="5" width="16" height="12" rx="2" />
        <path {...common} d="M8 21h8" />
        <path {...common} d="M12 17v4" />
      </svg>
    );
  }

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

function nextSetting(setting: ThemeSetting): ThemeSetting {
  if (setting === "system") {
    return "dark";
  }

  if (setting === "dark") {
    return "light";
  }

  return "system";
}

function labelFor(setting: ThemeSetting): string {
  if (setting === "system") {
    return "Theme: system (click to force dark mode)";
  }

  if (setting === "dark") {
    return "Theme: dark (click to switch to light mode)";
  }

  return "Theme: light (click to use system theme)";
}

export function ThemeToggle() {
  const [setting, setSetting] = useState<ThemeSetting | null>(null);

  useEffect(() => {
    setSetting(getStoredSetting());
  }, []);

  const displaySetting = setting ?? "system";
  const nextSettingForToggle = nextSetting(displaySetting);
  const label = labelFor(displaySetting);

  return (
    <button
      type="button"
      className="rpToolbarButton rpIconButton"
      aria-label={label}
      title={label}
      onClick={() => {
        const current = setting ?? "system";
        const updated = nextSetting(current);
        applySetting(updated);
        setSetting(updated);
      }}
    >
      {setting === null ? null : <Icon name={nextSettingForToggle} />}
    </button>
  );
}
