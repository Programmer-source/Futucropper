"use client";
/** Loading animation: a small Earth with an orbiting satellite, a pulsing dot row and true facts about the project. */
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

const FACTS = ["loader.fact1", "loader.fact2", "loader.fact3", "loader.fact4"];

export function Loader({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % FACTS.length), 3000);
    return () => clearInterval(id);
  }, []);
  const size = compact ? 56 : 92;
  return (
    <div role="status" aria-live="polite" className={`loader flex flex-col items-center justify-center text-center ${compact ? "py-3" : "py-6 min-h-[160px]"}`}>
      <div className="relative" style={{ width: size, height: size }} aria-hidden>
        <div className="loader-earth absolute rounded-full" style={{ inset: size * 0.2 }} />
        <div className="loader-orbit absolute inset-0 rounded-full border border-dashed border-rule">
          <svg className="loader-sat absolute" width={size * 0.22} height={size * 0.22} viewBox="0 0 20 20" style={{ left: `calc(50% - ${size * 0.11}px)`, top: -size * 0.11 }}>
            <rect x="7" y="7" width="6" height="6" rx="1" fill="#18231f" />
            <rect x="0" y="8" width="6" height="4" fill="#2457a6" />
            <rect x="14" y="8" width="6" height="4" fill="#2457a6" />
          </svg>
        </div>
      </div>
      <p className={`mt-3 font-semibold ${compact ? "text-sm" : ""}`}>{t("loader.title")}</p>
      <span className="loader-dots mt-1 flex gap-1.5" aria-hidden><i /><i /><i /></span>
      {!compact && <p key={i} className="loader-fact mt-2 text-sm text-moss measure">{t(FACTS[i])}</p>}
    </div>
  );
}

/** Grey rounded box with a soft shimmer, shown until a map has loaded */
export function MapSkeleton({ height = "h-[340px]" }: { height?: string }) {
  return <div className={`skeleton ${height} w-full rounded-lg border border-rule`} aria-hidden />;
}
