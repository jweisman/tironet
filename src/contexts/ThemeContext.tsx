"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

export type ThemePreference = "system" | "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  /** The resolved theme currently applied ("light" or "dark") */
  resolved: "light" | "dark";
}

const STORAGE_KEY = "tironet:theme";

const ThemeContext = createContext<ThemeContextValue>({
  preference: "system",
  setPreference: () => {},
  resolved: "light",
});

export function useTheme() {
  return useContext(ThemeContext);
}

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  // Update all meta theme-color tags for browser chrome.
  // Next.js renders two tags (one per media query). Set both to the resolved
  // color so the browser always picks the right one regardless of OS setting.
  const color = resolved === "dark" ? "#1a1a1a" : "#273617";
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", color);
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "system";
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    } catch {}
    return "system";
  });

  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(preference));

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {}
    const r = resolveTheme(pref);
    setResolved(r);
    applyTheme(r);
  }, []);

  // Apply theme on mount (the inline script handles initial class, but this
  // ensures React state is in sync)
  useEffect(() => {
    const r = resolveTheme(preference);
    setResolved(r);
    applyTheme(r);
  }, [preference]);

  // Listen for OS theme changes when preference is "system"
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = resolveTheme("system");
      setResolved(r);
      applyTheme(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  return (
    <ThemeContext.Provider value={{ preference, setPreference, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
