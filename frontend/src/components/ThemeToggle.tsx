"use client";
/** Sun/moon switch for the optional dark theme. Light is the default; the choice is saved in localStorage.
 *  An inline script in layout.tsx applies a saved "dark" before first paint, so there is no flash. */
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

const KEY = "ftc-theme";

export function ThemeToggle() {
  const { t } = useT();
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.getAttribute("data-theme") === "dark"); }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* storage blocked */ }
  }
  return (
    <button type="button" onClick={toggle} aria-label={t("theme.label")} title={t("theme.label")} aria-pressed={dark}
      className="theme-toggle rounded-full border border-rule bg-panel px-2 py-1.5 text-sm inline-flex items-center justify-center" data-theme-toggle>
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}
