"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import en from "@/i18n/en.json";
import uk from "@/i18n/uk.json";
import { uiDict } from "@/i18n/ui";

export type Lang = "en" | "uk" | "de" | "fr" | "it";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" }, { id: "uk", label: "Українська" }, { id: "de", label: "Deutsch" },
  { id: "fr", label: "Français" }, { id: "it", label: "Italiano" },
];
export const LOCALE: Record<Lang, string> = { en: "en-GB", uk: "uk-UA", de: "de-DE", fr: "fr-FR", it: "it-IT" };
const DICTS: Record<Lang, Record<string, unknown>> = {
  en: { ...en, ...uiDict("en") },
  uk: { ...uk, ...uiDict("uk") },
  de: uiDict("de"),
  fr: uiDict("fr"),
  it: uiDict("it"),
};
const isLang = (x: string | null): x is Lang => !!x && x in DICTS;

type Ctx = { lang: Lang; setLang: (l: Lang) => void };
const LangContext = createContext<Ctx>({ lang: "en", setLang: () => {} });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    let saved: string | null = new URLSearchParams(window.location.search).get("lang");
    try { saved = saved || localStorage.getItem("lang"); } catch { /* storage blocked */ }
    if (isLang(saved)) setLangState(saved);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("lang", l); } catch { /* storage blocked */ }
  };
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

/** t("key", {var}) — every visible word comes from the translation tables; missing keys fall back to English */
export function useT() {
  const { lang } = useLang();
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const raw = (DICTS[lang][key] ?? DICTS.en[key] ?? key) as string;
      if (typeof raw !== "string" || !vars) return String(raw);
      return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
    },
    [lang],
  );
  const list = useCallback((key: string) => ((DICTS[lang][key] ?? DICTS.en[key] ?? []) as string[]), [lang]);
  return { t, list, lang };
}

/** Month name in the current language, from the browser (no translation table needed) */
export function monthName(m: number, lang: Lang, style: "long" | "short" = "long") {
  return new Date(2021, m - 1, 15).toLocaleDateString(LOCALE[lang], { month: style });
}
