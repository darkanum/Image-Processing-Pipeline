/**
 * Dark mode / theme management.
 *
 * Three modes:
 *   - "system" — follow the user's OS preference (prefers-color-scheme)
 *   - "light"  — always light
 *   - "dark"   — always dark
 *
 * The active theme is persisted to localStorage. The `<html>` element gets
 * `data-theme="light"` or `data-theme="dark"` which the CSS uses to
 * override the default (light) variables.
 */

import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ipp.theme";

const isValidMode = (v: unknown): v is ThemeMode =>
  v === "system" || v === "light" || v === "dark";

/** Read the persisted theme mode. Falls back to "system". */
export const readStoredTheme = (): ThemeMode => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isValidMode(v) ? v : "system";
  } catch {
    return "system";
  }
};

const writeStoredTheme = (mode: ThemeMode): void => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage may be unavailable in private mode — silently ignore.
  }
};

/** Subscribe to OS-level color-scheme changes. Returns a cleanup function. */
const subscribeSystem = (cb: (e: MediaQueryListEvent) => void): (() => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  // `addEventListener` is the modern API; older Safari uses `addListener`.
  if (mq.addEventListener) {
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }
  mq.addListener(cb);
  return () => mq.removeListener(cb);
};

const systemPrefersDark = (): boolean => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const resolveTheme = (mode: ThemeMode, systemIsDark: boolean): ResolvedTheme => {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return systemIsDark ? "dark" : "light";
};

/** Apply the resolved theme to <html data-theme="...">. */
const applyToDocument = (resolved: ResolvedTheme): void => {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
};

interface UseThemeReturn {
  /** The user's chosen mode (system/light/dark). */
  mode: ThemeMode;
  /** The currently-active theme (always light or dark). */
  resolved: ResolvedTheme;
  /** Update the mode and persist it. */
  setMode: (m: ThemeMode) => void;
  /** Cycle to the next mode (system -> light -> dark -> system). */
  cycle: () => void;
}

/**
 * React hook for theme management. Re-renders the consumer when either
 * the user-picked mode or the OS preference changes.
 */
export const useTheme = (): UseThemeReturn => {
  const [mode, setModeState] = useState<ThemeMode>(readStoredTheme);
  // `systemDark` mirrors the OS preference; only relevant when mode=system.
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    return subscribeSystem((e) => setSystemDark(e.matches));
  }, []);

  const resolved = resolveTheme(mode, systemDark);

  useEffect(() => {
    applyToDocument(resolved);
  }, [resolved]);

  const setMode = (m: ThemeMode): void => {
    writeStoredTheme(m);
    setModeState(m);
  };

  const cycle = (): void => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    const idx = order.indexOf(mode);
    const next = order[(idx + 1) % order.length]!;
    setMode(next);
  };

  return { mode, resolved, setMode, cycle };
};
