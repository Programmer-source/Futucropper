"use client";
/** Small visual helpers: a number that counts up, a gauge ring and first-visit coach marks. No data logic. */
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts from 0 to value in ~0.8 s; shows the value at once with reduced motion. The final number is always `value`. */
export function CountUp({ value, ms = 800 }: { value: number; ms?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (reduced()) { setV(value); return; }
    // timers, not requestAnimationFrame: rAF pauses in background tabs and would leave the number at 0
    const t0 = Date.now();
    setV(0);
    const id = setInterval(() => {
      const f = Math.min(1, (Date.now() - t0) / ms);
      setV(Math.round(value * (1 - Math.pow(1 - f, 3))));
      if (f >= 1) clearInterval(id);
    }, 16);
    const end = setTimeout(() => { clearInterval(id); setV(value); }, ms + 60); // always ends on the real value
    return () => { clearInterval(id); clearTimeout(end); setV(value); };
  }, [value, ms]);
  return <>{v}</>;
}

/** Gauge ring around a round badge: fills to value/100 */
export function ScoreRing({ value }: { value: number }) {
  const r = 44, c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { const id = setTimeout(() => setShown(value), 30); return () => clearTimeout(id); }, [value]);
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="5" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, shown)) / 100)} className="score-ring" />
    </svg>
  );
}

const COACH_KEY = "ftc-coach-done";

/** First visit only: 3 small coach marks on the Map. Targets are elements with data-coach="1|2|3". */
export function CoachMarks() {
  const { t } = useT();
  const [step, setStep] = useState(0); // 0 = hidden
  useEffect(() => {
    let done = false;
    try { done = localStorage.getItem(COACH_KEY) === "1"; } catch { done = true; }
    if (done) return;
    const id = setTimeout(() => setStep(1), 2300); // after the splash
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    document.querySelectorAll(".coach-target").forEach((e) => e.classList.remove("coach-target"));
    if (!step) return;
    const el = document.querySelector(`[data-coach="${step}"]`);
    el?.classList.add("coach-target");
    return () => el?.classList.remove("coach-target");
  }, [step]);
  function finish() {
    try { localStorage.setItem(COACH_KEY, "1"); } catch { /* storage blocked */ }
    setStep(0);
  }
  if (!step) return null;
  return (
    <div className="coach fixed z-[1500] bottom-4 left-1/2 -translate-x-1/2 w-[min(92vw,380px)] rounded-lg bg-basalt text-white shadow-xl p-4" role="dialog" aria-label={t("coach.title")} data-coach-card>
      <p className="text-xs text-[#cfe0d4]">{t("coach.title")} · {step}/3</p>
      <p className="mt-1 font-semibold"><span className="inline-grid place-items-center w-6 h-6 rounded-full bg-canopy text-white text-xs mr-2">{step}</span>{t(`coach.${step}`)}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={finish} className="rounded-full border border-white/40 px-3 py-1 text-sm">{t("coach.skip")}</button>
        <button type="button" onClick={() => (step >= 3 ? finish() : setStep(step + 1))} className="rounded-full bg-white text-basalt px-3 py-1 text-sm font-semibold">{step >= 3 ? t("coach.done") : t("coach.next")}</button>
      </div>
    </div>
  );
}
