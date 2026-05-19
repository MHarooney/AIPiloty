"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

import en from "./locales/en.json";
import ar from "./locales/ar.json";

// ─── Types ───────────────────────────────────────────────────────
export type Locale = "en" | "ar";
export type Direction = "ltr" | "rtl";

type NestedMessages = { [key: string]: string | NestedMessages };

const MESSAGES: Record<Locale, NestedMessages> = { en, ar };

const RTL_LOCALES = new Set<Locale>(["ar"]);

const STORAGE_KEY = "aipiloty-locale";

// ─── Lookup helper ───────────────────────────────────────────────
function resolve(obj: NestedMessages, path: string): string | undefined {
  const parts = path.split(".");
  let node: NestedMessages | string | undefined = obj;
  for (const p of parts) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[p];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`
  );
}

// ─── Context ─────────────────────────────────────────────────────
interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in MESSAGES) {
      setLocaleState(stored as Locale);
    }
  }, []);

  // Update <html> dir/lang when locale changes
  useEffect(() => {
    const dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const msg = resolve(MESSAGES[locale], key) ?? resolve(MESSAGES.en, key) ?? key;
      return vars ? interpolate(msg, vars) : msg;
    },
    [locale]
  );

  const dir: Direction = RTL_LOCALES.has(locale) ? "rtl" : "ltr";

  return (
    <I18nContext.Provider value={{ locale, dir, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

// ─── Available locales for UI selectors ──────────────────────────
export const AVAILABLE_LOCALES: { code: Locale; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية" },
];
