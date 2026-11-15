"use client";
/** Intro splash, once per browser session (max 2 s; 0.5 s logo only with reduced motion). The app keeps loading
 *  underneath, so the splash adds no waiting time. Skip button, any click or any key skips.
 *  A tiny inline script in layout.tsx adds html.splash-seen before paint, so repeat visits never flash it. */
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

const KEY = "ftc-splash-seen";

export function Splash() {
  const { t } = useT();
  const [phase, setPhase] = useState<"show" | "out" | "gone">("show");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let seen = document.documentElement.classList.contains("splash-seen");
    try { seen = seen || sessionStorage.getItem(KEY) === "1"; sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked */ }
    if (seen) { setPhase("gone"); return; }
    const rm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(rm);
    const total = rm ? 500 : 2000;
    const out = setTimeout(() => setPhase("out"), total - (rm ? 150 : 300));
    const gone = setTimeout(() => setPhase("gone"), total);
    const skip = () => setPhase("gone");
    window.addEventListener("keydown", skip);
    return () => { clearTimeout(out); clearTimeout(gone); window.removeEventListener("keydown", skip); };
  }, []);

  if (phase === "gone") return null;
  return (
    <div className={`splash fixed inset-0 z-[2000] flex items-center justify-center ${phase === "out" ? "splash-out" : ""} ${reduced ? "splash-reduced" : ""}`}
      onClick={() => setPhase("gone")} data-splash>
      {!reduced && (
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <defs>
            <radialGradient id="sp-earth" cx="40%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#5fa8d3" /><stop offset="55%" stopColor="#2457a6" /><stop offset="100%" stopColor="#123060" />
            </radialGradient>
            <linearGradient id="sp-scan" x1="0" x2="1"><stop offset="0" stopColor="#bfe8ff" stopOpacity="0" /><stop offset="1" stopColor="#bfe8ff" stopOpacity=".9" /></linearGradient>
          </defs>
          {[[40, 40], [90, 80], [150, 30], [220, 60], [300, 35], [350, 90], [60, 120], [270, 110], [190, 100], [380, 20]].map(([x, y], k) => (
            <circle key={k} cx={x} cy={y} r={k % 3 ? 0.8 : 1.2} fill="#fff" opacity=".7" className="sp-star" />
          ))}
          <g className="sp-earth">
            <circle cx="200" cy="420" r="190" fill="url(#sp-earth)" />
            <path d="M80,300 q40,-30 90,-10 t90,-5 t70,15" fill="#3f8f5a" opacity=".55" />
            {/* the field: brown, turning green under the scan line */}
            <rect className="sp-field" x="150" y="248" width="100" height="18" rx="3" />
          </g>
          <g className="sp-sat">
            <rect x="-6" y="-4" width="12" height="8" rx="1.5" fill="#e8ece6" />
            <rect x="-22" y="-2.5" width="14" height="5" fill="#5fa8d3" /><rect x="8" y="-2.5" width="14" height="5" fill="#5fa8d3" />
            <path className="sp-beam" d="M-3,4 L-30,90 L30,90 L3,4 Z" fill="url(#sp-scan)" opacity=".35" />
          </g>
        </svg>
      )}
      <div className="relative text-center px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={reduced ? "/logo/logo-mark.webp" : "/logo/logo-animated.webp"} alt="" width={96} height={96} className="sp-mark mx-auto mb-4 w-24 h-24" />
        <p className="sp-logo font-display text-4xl sm:text-5xl font-semibold text-white">{t("app.name")}</p>
        <p className="sp-tag mt-3 text-[#cfe0d4]">{t("app.tagline2")}</p>
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); setPhase("gone"); }}
        className="absolute top-4 right-4 rounded-full border border-white/40 text-white px-4 py-1.5 text-sm hover:bg-white/10">{t("splash.skip")}</button>
    </div>
  );
}
