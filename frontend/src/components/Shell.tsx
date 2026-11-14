"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { API_URL } from "@/lib/api";
import { Lang, LANGS, useLang, useT } from "@/lib/i18n";
import { useZone } from "@/lib/zone";
import { ZonePicker } from "./ZonePicker";

const NAV = [["/", "nav.map"], ["/plan", "nav.plan"], ["/science", "nav.science"]] as const;
const SCIENCE = ["/science", "/now", "/dashboard", "/trends", "/chain", "/expected", "/compare", "/assistant", "/expert", "/roadmap"];

export function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const { lang, setLang } = useLang();
  const { meta, metaError } = useZone();
  const path = usePathname();
  const inScience = SCIENCE.some((p) => path.startsWith(p));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-rule bg-panel">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-4 pb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href="/" className="flex items-baseline gap-3 mr-auto">
            <span className="font-display text-lg font-semibold">{t("app.name")}</span>
            <span className="hidden md:inline text-sm text-moss">{t("app.tagline2")}</span>
          </Link>
          {inScience && path !== "/science" && <ZonePicker />}
          <label className="text-sm flex items-center gap-2">
            <span className="sr-only">{t("lang.label")}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("lang.label")}
              className="rounded-full border border-rule bg-panel px-3 py-1.5">
              {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
        </div>
        <nav className="mx-auto max-w-6xl px-4 sm:px-6 flex gap-1 overflow-x-auto" aria-label="Sections">
          {NAV.map(([href, key]) => {
            const active = href === "/" ? path === "/" : href === "/science" ? inScience : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap px-4 py-2.5 text-base border-b-2 ${
                  active ? "border-basalt font-semibold" : "border-transparent text-moss hover:text-basalt"
                }`}
              >
                {t(key)}
              </Link>
            );
          })}
        </nav>
      </header>

      {meta?.mock && (
        <div className="bg-[#fbf3dc] border-b border-[#ecd9a3] text-sm">
          <p className="mx-auto max-w-6xl px-4 sm:px-6 py-2">{t("mock.banner")}</p>
        </div>
      )}

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6">
        {metaError ? <p className="measure text-scorch">{t("state.offline", { url: API_URL })}</p> : children}
      </main>

      <footer className="border-t border-rule text-sm text-moss">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5">NASA MODIS, GPM IMERG, GLDAS, MERRA-2; NOAA PSL, NOAA GML; World Bank.</div>
      </footer>
    </div>
  );
}
