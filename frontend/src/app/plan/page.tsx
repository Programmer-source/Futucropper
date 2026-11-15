"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AIText, useAI } from "@/components/AIBox";
import { post, useApi, Zone } from "@/lib/api";
import { big, LIGHT_COLOR, num } from "@/lib/format";
import { monthName, useT } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { Msg } from "@/lib/llm";
import { askAI, clean } from "@/lib/llm";
import { useZone, useZoneName } from "@/lib/zone";

const PlanMap = dynamic(() => import("@/components/maps").then((m) => m.PlanMap), { ssr: false });

type Options = Record<string, { country: "UA" | "AU"; sow: number[]; irrigated_only: boolean }>;
type Form = {
  lat: number | null; lon: number | null; crop: string; sow: number; irrigation: "none" | "partial" | "full"; soil: string;
  area: number; unit: string; n_kg_ha: string; fert: string; tillage: string; fuel_l_ha: string; rice_water: string; notes: string; horizon: string;
};
type Row = {
  year: number; score: number; dry_key_chance: number | null; soil_mm_change: number | null; cell_mm_change: number | null;
  temp_change_c: number | null; co2_ppm: number | null; ghg_cum_t: number; flag: "ok" | "watch" | "switch"; alternatives: { crop: string; score: number }[];
};
type Result = {
  zone: Zone; crop: string; country: string; sow: number; irrigation: string; area: number; unit: string; area_ha: number;
  lat: number | null; lon: number | null; score: number; risks: Record<string, number | null>; heat_days: number | null; key_months: number[];
  months: { m: number; score: number; typical: boolean; viable: boolean }[]; best_month: number; best_score: number; warnings: string[];
  soil_water: { store_mm: number; easy_mm: number } | null;
  seed: { rate_kg_ha: number; range_kg_ha: [number, number]; total_kg: number; row_cm: number; depth_cm: [number, number]; rows: number; side_m: number; dry_site_low_rate: boolean };
  harvest: { kg_ha: number; low: number; high: number; total_t: number } | null;
  ghg: { per_ha_kg: number; total_t: number; parts_kg_ha: Record<string, number>; fuel_typical: boolean; n_typical: boolean; n_kg_ha: number; fuel_l_ha: number;
    per_t_grain_kg?: number; tips: { code: string; save_kg_ha: number; save_t_total: number; pct: number }[] };
  horizon: { kind: string; dry_spell_chance_pct?: number; from?: string; target?: string; ndvi_z?: number; low?: number; high?: number; light?: "green" | "yellow" | "red"; beats_baseline?: boolean };
  scenario: null | { years: number[]; rows: Row[]; score_today: number; dry_key_today: number | null; soil_trend_p: number | null;
    cells: { cells: { lat: number; lon: number; change_mm: number[]; base_mm: number }[]; resolution: number } | null };
  messages: Msg[];
};

const SOILS = ["unknown", "sand", "loamy_sand", "sandy_loam", "loam", "silt_loam", "silty_clay_loam", "clay"];
const UNITS = ["ha", "acre", "sotka", "m2", "km2"];
const HORIZONS = ["8d", "1m", "3m", "1y", "3y", "5y", "10y"];
const RISK_W: Record<string, number> = { dry_sowing: 0.30, rain_fail: 0.20, dry_key: 0.25, heat: 0.15, frost: 0.10 };

const chip = (on: boolean) => `text-sm px-3 py-1.5 rounded-full border ${on ? "bg-basalt text-white border-basalt" : "border-rule bg-panel hover:border-basalt"}`;
const scoreTone = (s: number) => (s >= 75 ? "green" : s >= 55 ? "yellow" : "red") as "green" | "yellow" | "red";

/** soil-water change (mm): brown = drier, blue = wetter */
function waterColor(v: number | null) {
  if (v === null) return "#d6dbd3";
  const f = Math.max(-1, Math.min(1, v / 25));
  const mid = [238, 234, 220], dry = [140, 81, 30], wet = [36, 87, 166];
  const end = f < 0 ? dry : wet;
  const c = mid.map((x, k) => Math.round(x + (end[k] - x) * Math.abs(f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="py-4 border-b border-rule last:border-0">
      <h2 className="text-base font-semibold flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-basalt text-white text-xs grid place-items-center">{n}</span>{title}</h2>
      {hint && <p className="text-xs text-moss mt-1">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function PlanPage() {
  const { t, lang } = useT();
  const { meta } = useZone();
  const name = useZoneName();
  const opts = useApi<Options>("/api/advisor/options");
  const [f, setF] = useState<Form>({ lat: null, lon: null, crop: "winter_wheat", sow: 9, irrigation: "none", soil: "unknown", area: 10, unit: "ha",
    n_kg_ha: "", fert: "other", tillage: "reduced", fuel_l_ha: "", rice_water: "flooded", notes: "", horizon: "3m" });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const [reg, setReg] = useState<"UA" | "AU">("UA");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const lat = Number(q.get("lat")), lon = Number(q.get("lon")), crop = q.get("crop");
    if (q.get("lat") && !Number.isNaN(lat) && !Number.isNaN(lon)) {
      setF((x) => ({ ...x, lat, lon, ...(crop ? { crop } : {}) }));
      setReg(lat < 0 ? "AU" : "UA");
    }
  }, []);
  const crops = useMemo(() => Object.entries(opts.data ?? {}).filter(([, v]) => v.country === reg).map(([k]) => k), [opts.data, reg]);
  const crop = opts.data?.[f.crop];
  useEffect(() => {
    if (crops.length && !crops.includes(f.crop)) setF((x) => ({ ...x, crop: crops[0] }));
  }, [crops, f.crop]);
  useEffect(() => { if (crop) setF((x) => ({ ...x, sow: crop.sow[0] })); }, [f.crop]); // eslint-disable-line react-hooks/exhaustive-deps

  const zones = (meta?.zones ?? []).filter((z) => z.country === reg);
  const bounds: [[number, number], [number, number]] | null = zones.length
    ? [[Math.min(...zones.map((z) => z.south)) - 0.3, Math.min(...zones.map((z) => z.west)) - 0.3], [Math.max(...zones.map((z) => z.north)) + 0.3, Math.max(...zones.map((z) => z.east)) + 0.3]]
    : null;

  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [stepsBody, setStepsBody] = useState<Record<string, unknown> | null>(null);
  const steps = useSteps(stepsBody);
  async function calc(form: Form = f) {
    if (form.lat === null || form.lon === null) { setErr(t("p.need_place")); return; }
    setBusy(true); setErr(null);
    try {
      const body = { ...form, n_kg_ha: form.n_kg_ha === "" ? null : Number(form.n_kg_ha), fuel_l_ha: form.fuel_l_ha === "" ? null : Number(form.fuel_l_ha), lang };
      setStepsBody(body);
      const r = await post<Result>("/api/plan", body);
      setRes(r);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }
  function tryTip(code: string) {
    const next = { ...f };
    if (code === "n_minus_20") next.n_kg_ha = String(Math.round((res?.ghg.n_kg_ha ?? 0) * 0.8));
    if (code === "no_urea") next.fert = "other";
    if (code === "notill") { next.tillage = "notill"; if (next.fuel_l_ha !== "") next.fuel_l_ha = String(Math.max(0, Number(next.fuel_l_ha) - (f.tillage === "plough" ? 35 : 15))); }
    if (code === "rice_awd") next.rice_water = "multiple";
    if (code === "no_leaching") next.irrigation = "none";
    setF(next);
    calc(next);
  }

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold">{t("p.title")}</h1>
      <p className="measure mt-2 text-moss">{t("p.lead")}</p>

      <div className="mt-5 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-start">
        <form onSubmit={(e) => { e.preventDefault(); calc(); }} className="rounded-lg bg-panel border border-rule px-4">
          <Step n={1} title={t("p.s1")} hint={t("p.s1_hint")}>
            <div className="flex flex-wrap gap-2 mb-2">
              {(["UA", "AU"] as const).map((r) => <button type="button" key={r} onClick={() => { setReg(r); setF((x) => ({ ...x, lat: null, lon: null })); }} className={chip(reg === r)}>{t(`country.${r}`)}</button>)}
              {zones.map((z) => (
                <button type="button" key={z.zone} onClick={() => setF((x) => ({ ...x, lat: z.lat, lon: z.lon }))} className="text-xs px-2.5 py-1 rounded-full border border-rule hover:border-basalt">{name(z.zone)}</button>
              ))}
            </div>
            {bounds && <PlanMap bounds={bounds} zones={zones} picked={f.lat !== null && f.lon !== null ? { lat: f.lat, lon: f.lon } : null}
              onPick={(lat, lon) => setF((x) => ({ ...x, lat, lon }))} height="h-[260px]" />}
            {f.lat !== null && f.lon !== null && <p className="mt-1 text-xs text-moss tabular">{num(f.lat, 3, false, lang)}°, {num(f.lon, 3, false, lang)}°</p>}
          </Step>

          <Step n={2} title={t("p.s2")}>
            <div className="flex flex-wrap gap-2">{crops.map((c) => <button type="button" key={c} onClick={() => set("crop", c)} className={chip(f.crop === c)}>{t(`crop.${c}`)}</button>)}</div>
          </Step>

          <Step n={3} title={t("p.s3")} hint={t("p.s3_hint")}>
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const typical = crop?.sow.includes(m);
                return (
                  <button type="button" key={m} onClick={() => set("sow", m)} aria-pressed={f.sow === m}
                    className={`text-sm py-1.5 rounded-md border ${f.sow === m ? "bg-basalt text-white border-basalt" : typical ? "border-canopy bg-[#e5f0e8]" : "border-rule"}`}>
                    {monthName(m, lang, "short")}{typical && <span aria-hidden> •</span>}
                  </button>
                );
              })}
            </div>
          </Step>

          <Step n={4} title={t("p.s4")}>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1"><span className="text-moss">{t("p.soil")}</span>
                <select value={f.soil} onChange={(e) => set("soil", e.target.value)} className="rounded-md border border-rule px-2 py-1.5 bg-panel">
                  {SOILS.map((s) => <option key={s} value={s}>{s === "unknown" ? t("p.dont_know") : t(`soil.${s}`)}</option>)}
                </select></label>
              <label className="flex flex-col gap-1"><span className="text-moss">{t("p.area")}</span>
                <span className="flex gap-2">
                  <input type="number" min={0.01} step="any" value={f.area} onChange={(e) => set("area", Number(e.target.value))} className="w-24 rounded-md border border-rule px-2 py-1.5" />
                  <select value={f.unit} onChange={(e) => set("unit", e.target.value)} className="rounded-md border border-rule px-2 py-1.5 bg-panel">
                    {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
                  </select>
                </span></label>
            </div>
            <p className="text-sm text-moss mt-3 mb-1">{t("p.irr")}</p>
            <div className="flex flex-wrap gap-2">{(["none", "partial", "full"] as const).map((v) => <button type="button" key={v} onClick={() => set("irrigation", v)} className={chip(f.irrigation === v)}>{t(`p.irr.${v}`)}</button>)}</div>
          </Step>

          <Step n={5} title={t("p.s5")} hint={t("p.s5_hint")}>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1"><span className="text-moss">{t("p.n")}</span>
                <input type="number" min={0} value={f.n_kg_ha} placeholder={t("p.typical")} onChange={(e) => set("n_kg_ha", e.target.value)} className="rounded-md border border-rule px-2 py-1.5" /></label>
              <label className="flex flex-col gap-1"><span className="text-moss">{t("p.fert")}</span>
                <select value={f.fert} onChange={(e) => set("fert", e.target.value)} className="rounded-md border border-rule px-2 py-1.5 bg-panel">
                  {["other", "urea", "uan"].map((v) => <option key={v} value={v}>{t(`p.fert.${v}`)}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="text-moss">{t("p.till")}</span>
                <select value={f.tillage} onChange={(e) => set("tillage", e.target.value)} className="rounded-md border border-rule px-2 py-1.5 bg-panel">
                  {["plough", "reduced", "notill"].map((v) => <option key={v} value={v}>{t(`p.till.${v}`)}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="text-moss">{t("p.fuel")}</span>
                <input type="number" min={0} value={f.fuel_l_ha} placeholder={t("p.typical")} onChange={(e) => set("fuel_l_ha", e.target.value)} className="rounded-md border border-rule px-2 py-1.5" /></label>
              {f.crop === "rice" && (
                <label className="flex flex-col gap-1"><span className="text-moss">{t("p.rice")}</span>
                  <select value={f.rice_water} onChange={(e) => set("rice_water", e.target.value)} className="rounded-md border border-rule px-2 py-1.5 bg-panel">
                    {["flooded", "single", "multiple"].map((v) => <option key={v} value={v}>{t(`p.rice.${v}`)}</option>)}</select></label>
              )}
            </div>
          </Step>

          <Step n={6} title={t("p.notes")}>
            <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("p.notes_ph")} rows={3} maxLength={1500}
              className="w-full rounded-md border border-rule px-3 py-2 text-sm" />
          </Step>

          <Step n={7} title={t("p.s6")}>
            <div className="flex flex-wrap gap-2">{HORIZONS.map((h) => <button type="button" key={h} onClick={() => set("horizon", h)} className={chip(f.horizon === h)}>{t(`p.h.${h}`)}</button>)}</div>
          </Step>

          <div className="py-4">
            <button type="submit" disabled={busy} className="w-full rounded-full bg-canopy text-white text-lg font-semibold py-3 disabled:opacity-50">{busy ? t("p.calc_busy") : t("p.calc")}</button>
            {err && <p className="mt-2 text-sm text-scorch">{err}</p>}
          </div>
        </form>

        <div ref={resultRef} className="scroll-mt-4">
          {!res && <div className="rounded-lg border border-dashed border-rule p-6 text-moss">{t("r.empty")}</div>}
          {res && <ResultView r={res} onTry={tryTip} busy={busy} steps={steps} />}
        </div>
      </div>
    </div>
  );
}

function parseAI(text: string, years: number[]) {
  const out = { summary: [] as string[], tips: [] as string[], years: {} as Record<number, string>, rest: [] as string[] };
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^[•\s]+/, "").trim();
    if (!line) continue;
    const y = /^(?:YEAR|РІК|JAHR|ANNÉE|ANNEE|ANNO|SEASON|СЕЗОН)?\s*(20\d\d)\s*[:\-–—]\s*(.+)$/i.exec(line);
    if (y && years.includes(Number(y[1]))) { out.years[Number(y[1])] = y[2]; continue; }
    const s = /^(SUMMARY|TIP)\s*:\s*(.*)$/i.exec(line);
    if (s) { (s[1].toUpperCase() === "TIP" ? out.tips : out.summary).push(s[2]); continue; }
    (out.summary.length || out.tips.length ? out.rest : out.summary).push(line);
  }
  return out;
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-panel border border-rule p-4 sm:p-5 mb-4">
      {title && <h3 className="font-semibold mb-3">{title}</h3>}
      {children}
    </section>
  );
}

function ResultView({ r, onTry, busy, steps }: { r: Result; onTry: (code: string) => void; busy: boolean; steps?: StepsState }) {
  const { t, lang } = useT();
  const name = useZoneName();
  const tone = scoreTone(r.score);
  const ai = useAI(r.messages);
  const years = r.scenario?.years ?? [];
  const parsed = useMemo(() => (ai.text ? parseAI(ai.text, years) : null), [ai.text]); // eslint-disable-line react-hooks/exhaustive-deps
  const keyMonths = r.key_months.map((m) => monthName(m, lang, "short")).join("–");
  const reasons = Object.entries(r.risks).filter(([, v]) => v !== null && v > 0).sort((a, b) => RISK_W[b[0]] * (b[1] ?? 0) - RISK_W[a[0]] * (a[1] ?? 0)).slice(0, 3);
  const areaTxt = `${big(r.area, 2, lang)} ${t(`unit.${r.unit}`)}`;
  const kg = (v: number) => (v >= 1000 ? `${big(v / 1000, 2, lang)} t` : `${big(v, 1, lang)} kg`);
  const parts = Object.entries(r.ghg.parts_kg_ha).filter(([, v]) => v > 0);
  const bounds: [[number, number], [number, number]] | null = r.lat !== null && r.lon !== null
    ? (() => { const d = Math.max(0.01, (r.seed.side_m / 111320) * 2.2); return [[r.lat - d, r.lon - d * 1.4], [r.lat + d, r.lon + d * 1.4]]; })() : null;

  return (
    <div className={busy ? "opacity-60 transition-opacity" : ""}>
      <Card>
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-24 h-24 rounded-full grid place-items-center text-white" style={{ background: LIGHT_COLOR[tone] }}>
            <span className="text-3xl font-semibold tabular">{r.score}</span>
          </div>
          <div>
            <p className="text-xs text-moss">{t("r.score")} /100</p>
            <p className="text-xl font-semibold">{t(tone === "green" ? "r.good" : tone === "yellow" ? "r.mid" : "r.bad")}</p>
            <p className="text-sm mt-1">{t("r.verdict", { crop: t(`crop.${r.crop}`), month: monthName(r.sow, lang), zone: name(r.zone.zone) })}</p>
            <p className="text-xs text-moss mt-1">{t("r.score_note")}</p>
          </div>
        </div>
        {r.warnings.length > 0 && (
          <ul className="mt-3 space-y-1">{r.warnings.map((w) => <li key={w} className="text-sm rounded-md bg-[#fbf3dc] border border-[#ecd9a3] px-3 py-1.5">⚠ {t(`w.${w}`)}</li>)}</ul>
        )}
        {reasons.length > 0 && (
          <>
            <p className="mt-4 text-sm font-semibold">{t("r.why")}</p>
            <ul className="mt-1 text-sm list-disc pl-5 space-y-0.5">
              {reasons.map(([k, v]) => (
                <li key={k}>{k === "heat" ? t("r.risk.heat", { days: num(r.heat_days, 1, false, lang) }) : t(`r.risk.${k}`, { pct: Math.round((v ?? 0) * 100), months: keyMonths })}</li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-sm font-semibold">{t("r.months")}</p>
        <div className="mt-2 grid grid-cols-12 gap-1 items-end h-24" role="img" aria-label={t("r.months")}>
          {r.months.map((m) => (
            <div key={m.m} className="flex flex-col items-center justify-end h-full" title={`${monthName(m.m, lang)}: ${m.score}`}>
              <span className="text-[10px] tabular text-moss">{m.viable ? m.score : "✕"}</span>
              <div className="w-full rounded-t" style={{ height: m.viable ? `${Math.max(4, m.score * 0.6)}%` : "4%", background: m.viable ? LIGHT_COLOR[scoreTone(m.score)] : "#c9cfc6", opacity: m.typical ? 1 : 0.4,
                outline: m.m === r.sow ? "2px solid #18231f" : "none" }} />
              <span className={`text-[10px] mt-0.5 ${m.typical ? "font-semibold" : "text-moss"}`}>{monthName(m.m, lang, "short").slice(0, 3)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-moss mt-2">{t("r.best", { month: monthName(r.best_month, lang), score: r.best_score })}</p>
      </Card>

      {steps?.data && <StepsCard s={steps} />}

      <Card title={t("r.ahead")}>
        {r.horizon.kind === "8d" && r.horizon.dry_spell_chance_pct !== undefined && <p>{t("r.h8d", { pct: r.horizon.dry_spell_chance_pct, date: r.horizon.from ?? "" })}</p>}
        {(r.horizon.kind === "1m" || r.horizon.kind === "3m") && r.horizon.target && (
          <>
            <p>{t("r.hm", { target: r.horizon.target, z: num(r.horizon.ndvi_z, 2, true, lang), lo: num(r.horizon.low, 2, true, lang), hi: num(r.horizon.high, 2, true, lang), state: t(`light.${r.horizon.light}`) })}</p>
            <p className="text-xs text-moss mt-1">{t("r.z_note")} {!r.horizon.beats_baseline && t("r.no_skill")}</p>
          </>
        )}
        {r.scenario && <p>{t("r.today", { score: r.scenario.score_today, pct: Math.round((r.scenario.dry_key_today ?? 0) * 100) })} ↓</p>}
      </Card>

      <Card title={t("r.ai")}>
        <AIText ai={ai}>
          {parsed && (
            <div className="space-y-2">
              {parsed.summary.map((s, i) => <p key={i}>{s}</p>)}
              {parsed.tips.length > 0 && <ul className="list-disc pl-5 space-y-1">{parsed.tips.map((s, i) => <li key={i}>{s}</li>)}</ul>}
              {parsed.rest.map((s, i) => <p key={`r${i}`} className="text-sm">{s}</p>)}
            </div>
          )}
        </AIText>
      </Card>

      <Card title={t("r.field")}>
        {bounds && r.lat !== null && r.lon !== null && (
          <div className="mb-3"><PlanMap bounds={bounds} zones={[]} picked={{ lat: r.lat, lon: r.lon }} fieldSideM={r.seed.side_m} height="h-[200px]" /></div>
        )}
        <p><b>{t("r.seed", { rate: big(r.seed.rate_kg_ha, 1, lang), total: kg(r.seed.total_kg), area: areaTxt })}</b> <span className="text-sm text-moss">({t("r.seed_range", { lo: r.seed.range_kg_ha[0], hi: r.seed.range_kg_ha[1] })})</span></p>
        {r.seed.dry_site_low_rate && <p className="text-sm text-moss">{t("r.seed_dry")}</p>}
        <p className="text-sm mt-1">{t("r.rows", { row: num(r.seed.row_cm, r.seed.row_cm % 1 ? 1 : 0, false, lang), depth: `${r.seed.depth_cm[0]}–${r.seed.depth_cm[1]}`, side: big(r.seed.side_m, 0, lang), n: big(r.seed.rows, 0, lang) })}</p>
        {r.soil_water && <p className="text-sm mt-2">{t("r.soilw", { store: r.soil_water.store_mm, easy: r.soil_water.easy_mm })}</p>}
        {r.harvest && <p className="text-sm mt-2">{t("r.harvest", { kg: big(r.harvest.kg_ha, 0, lang), lo: big(r.harvest.low, 0, lang), hi: big(r.harvest.high, 0, lang), t: big(r.harvest.total_t, 1, lang) })}</p>}
      </Card>

      <Card title={t("r.ghg")}>
        <p className="text-lg font-semibold">{t("r.ghg_total", { t: big(r.ghg.total_t, 2, lang), ha: big(r.ghg.per_ha_kg, 0, lang) })}</p>
        {r.ghg.per_t_grain_kg && <p className="text-sm text-moss">{t("r.ghg_grain", { kg: big(r.ghg.per_t_grain_kg, 0, lang) })}</p>}
        <div className="mt-3 flex h-4 rounded overflow-hidden" role="img" aria-label={t("r.ghg")}>
          {parts.map(([k, v], i) => <span key={k} style={{ width: `${(100 * v) / r.ghg.per_ha_kg}%`, background: ["#2457a6", "#6b4fa0", "#56655d", "#c99312"][i % 4] }} />)}
        </div>
        <ul className="mt-2 text-sm grid sm:grid-cols-2 gap-x-4">
          {parts.map(([k, v], i) => (
            <li key={k} className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: ["#2457a6", "#6b4fa0", "#56655d", "#c99312"][i % 4] }} />
              {t(`r.ghg.${k}`)}: <span className="tabular">{big(v, 0, lang)} kg/ha</span></li>
          ))}
        </ul>
        <p className="text-xs text-moss mt-2">
          N {big(r.ghg.n_kg_ha, 0, lang)} kg/ha{r.ghg.n_typical ? ` (${t("p.typical")})` : ""} · {t("r.ghg.diesel")} {big(r.ghg.fuel_l_ha, 0, lang)} l/ha{r.ghg.fuel_typical ? ` (${t("p.typical")})` : ""}. {t("r.ghg_scope")}
        </p>
        {r.ghg.tips.length > 0 && (
          <>
            <p className="mt-4 font-semibold text-sm">{t("r.cut")}</p>
            <ul className="mt-2 space-y-2">
              {r.ghg.tips.map((tp) => (
                <li key={tp.code} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1 min-w-48">{t(`tip.${tp.code}`)}: <b className="text-canopy">{t("r.saves", { t: big(tp.save_t_total, 2, lang), pct: num(tp.pct, 0, false, lang) })}</b></span>
                  <button onClick={() => onTry(tp.code)} className="rounded-full border border-basalt px-3 py-1">{t("r.try")}</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {r.scenario && <Scenario r={r} yearTips={parsed?.years ?? {}} aiBusy={ai.busy} />}
    </div>
  );
}

function Scenario({ r, yearTips, aiBusy }: { r: Result; yearTips: Record<number, string>; aiBusy: boolean }) {
  const { t, lang } = useT();
  const sc = r.scenario!;
  const [i, setI] = useState(0);
  const [play, setPlay] = useState(false);
  useEffect(() => { setI(0); setPlay(false); }, [r]);
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => setI((x) => (x + 1 >= sc.rows.length ? 0 : x + 1)), 1400);
    return () => clearInterval(id);
  }, [play, sc.rows.length]);
  const row = sc.rows[Math.min(i, sc.rows.length - 1)];
  const cells = (sc.cells?.cells ?? []).map((c) => ({ lat: c.lat, lon: c.lon, value: c.change_mm[i] ?? null,
    label: `${num(c.change_mm[i], 1, true, lang)} mm (${num(c.base_mm, 0, false, lang)} mm 2003–21)` }));
  const lats = cells.map((c) => c.lat), lons = cells.map((c) => c.lon);
  const bounds: [[number, number], [number, number]] | null = cells.length ? [[Math.min(...lats) - 0.2, Math.min(...lons) - 0.2], [Math.max(...lats) + 0.2, Math.max(...lons) + 0.2]] : null;
  const flagColor = row.flag === "ok" ? LIGHT_COLOR.green : row.flag === "watch" ? LIGHT_COLOR.yellow : LIGHT_COLOR.red;
  const alt = row.alternatives[0];

  return (
    <Card title={t("r.sim")}>
      <p className="text-xs text-moss">{t("r.sim_note")} {sc.soil_trend_p !== null && (sc.soil_trend_p < 0.05 ? t("r.trend_ok", { p: num(sc.soil_trend_p, 2, false, lang) }) : t("r.trend_weak", { p: num(sc.soil_trend_p, 2, false, lang) }))}</p>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => setPlay((p) => !p)} className="rounded-full bg-basalt text-white w-10 h-10 shrink-0" aria-label="play">{play ? "❚❚" : "▶"}</button>
        <input type="range" min={0} max={sc.rows.length - 1} value={i} onChange={(e) => { setPlay(false); setI(Number(e.target.value)); }} className="flex-1" aria-label={t("r.year", { year: row.year })} />
        <span className="font-semibold tabular w-24 text-right">{t("r.year", { year: row.year })}</span>
      </div>
      {bounds && (
        <div className="mt-3">
          <PlanMap bounds={bounds} zones={[]} picked={r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : null} cells={cells} cellRes={sc.cells?.resolution} cellColor={waterColor} height="h-[260px]" />
          <div className="mt-1 flex items-center gap-2 text-xs text-moss">
            <span>{t("r.legend_dry")} −25 mm</span>
            <span className="flex h-3 w-32 rounded overflow-hidden">{[-25, -12, 0, 12, 25].map((v) => <span key={v} className="flex-1" style={{ background: waterColor(v) }} />)}</span>
            <span>+25 mm {t("r.legend_wet")}</span>
          </div>
        </div>
      )}
      <div className="mt-3 rounded-md px-3 py-2 text-white font-semibold" style={{ background: flagColor }}>
        {row.flag === "switch" && alt ? t("r.flag.switch", { alt: `${t(`crop.${alt.crop}`)} (${alt.score}/100)` }) : t(`r.flag.${row.flag}`)}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-moss">{t("r.y.score")}</dt><dd className="tabular font-semibold">{row.score}/100</dd>
        <dt className="text-moss">{t("r.y.dry")}</dt><dd className="tabular">{row.dry_key_chance === null ? "—" : `${Math.round(row.dry_key_chance * 100)}%`}</dd>
        <dt className="text-moss">{t("r.y.soil")}</dt><dd className="tabular">{num(row.cell_mm_change ?? row.soil_mm_change, 1, true, lang)} mm</dd>
        <dt className="text-moss">{t("r.y.temp")}</dt><dd className="tabular">{num(row.temp_change_c, 2, true, lang)} °C</dd>
        <dt className="text-moss">{t("r.y.co2")}</dt><dd className="tabular">{num(row.co2_ppm, 1, false, lang)} ppm</dd>
        <dt className="text-moss">{t("r.y.ghg")}</dt><dd className="tabular">{big(row.ghg_cum_t, 1, lang)} t CO₂e</dd>
      </dl>
      <div className="mt-3 rounded-md bg-chalk px-3 py-2 text-sm">
        <span className="font-semibold">{t("r.ai_year")}: </span>
        {yearTips[row.year] ?? (aiBusy ? t("ai.thinking") : "—")}
      </div>
    </Card>
  );
}

/* ---------- Step by step (new): numbers from /api/plan/steps at once; AI text via askAI, like the "AI analysis" card ---------- */
type StepItem = { month: number; kind: "prepare" | "sow" | "establish" | "winter" | "frost" | "key" | "harvest"; values: Record<string, number | number[] | boolean | null> };
type YearItem = { year: number; score: number; flag: "ok" | "watch" | "switch"; dry_key_chance: number | null; soil_mm_change: number | null;
  temp_change_c: number | null; alternative: { crop: string; score: number } | null };
type StepsData = { season: StepItem[]; years: YearItem[]; messages: Msg[] };
type StepsState = { data: StepsData | null };
const STEPS_AI_TIMEOUT_MS = 120000;
const stepsAiCache = new Map<string, string>(); // successful answers only
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Fetches the steps (numbers + prompt) in parallel with /api/plan; never blocks the result. */
function useSteps(body: Record<string, unknown> | null): StepsState {
  const [s, setS] = useState<StepsState>({ data: null });
  useEffect(() => {
    if (!body) return;
    let alive = true;
    setS({ data: null });
    post<StepsData>("/api/plan/steps", body).then((d) => alive && setS({ data: d })).catch(() => {});
    return () => { alive = false; };
  }, [body]);
  return s;
}

const STEP_WORD = /^(?:step|крок|шаг|schritt|étape|etape|passo|fase)\s*\d*\s*[:.\-–—]?\s*/i;
const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,]/g, "");

/** Tolerant parser: any language, any case, with or without STEP/YEAR words; month names in English or the user's language.
 *  Step lines are matched by month (first free step with that month), else by order; year lines by a known year. */
function parseSteps(text: string, steps: StepItem[], years: number[], lang: Lang) {
  const names = (m: number) => [MONTHS_EN[m - 1], monthName(m, lang, "long"), monthName(m, lang, "short"), String(m)].map(norm);
  const out = { steps: {} as Record<number, string>, years: {} as Record<number, string>, rest: [] as string[] };
  let order = 0, found = 0;
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^[\s•*\-#]+/, "").replace(/\*\*/g, "").trim();
    if (!line) continue;
    const yr = /^(?:\D{0,12}?)(20\d\d)\b[^:]{0,30}[:\-–—]\s*(.+)$/.exec(line);
    if (yr && years.includes(Number(yr[1]))) { out.years[Number(yr[1])] = yr[2]; found++; continue; }
    const hadWord = STEP_WORD.test(line);
    const rest = line.replace(STEP_WORD, "");
    const head = /^([^:\-–—]{1,30})[:\-–—]\s*(.+)$/.exec(rest);
    const token = norm((head ? head[1] : rest).split(/[\s(\[]/)[0] ?? "");
    let idx = -1;
    if (token.length >= 3) {
      idx = steps.findIndex((st, k) => out.steps[k] === undefined && names(st.month).some((n) => {
        const len = Math.min(4, token.length, n.length);
        return len >= 3 && n.slice(0, len) === token.slice(0, len);
      }));
    }
    if (idx < 0 && hadWord) { while (order < steps.length && out.steps[order] !== undefined) order++; idx = order < steps.length ? order : -1; }
    if (idx >= 0) { out.steps[idx] = head ? head[2] : rest; found++; }
    else out.rest.push(line); // never lose AI text: unmatched lines are shown under the card
  }
  return found ? out : null;
}

function StepsCard({ s }: { s: StepsState }) {
  const { t, lang } = useT();
  const { meta } = useZone();
  const d = s.data!;
  const key = JSON.stringify(d.messages);
  const [ai, setAi] = useState<{ key: string; text: string | null; state: "loading" | "done" | "failed" }>({ key: "", text: null, state: "loading" });
  useEffect(() => {
    const hit = stepsAiCache.get(key);
    if (hit) { setAi({ key, text: hit, state: "done" }); return; }
    let alive = true;
    setAi({ key, text: null, state: "loading" });
    const timer = setTimeout(() => alive && setAi((x) => (x.key === key && x.state === "loading" ? { key, text: null, state: "failed" } : x)), STEPS_AI_TIMEOUT_MS);
    const serverKey = !!meta?.llm;
    const yearsList = d.years.map((y) => y.year);
    // a cut-off answer (fewer than half the steps, or no years) gets one "continue" call; the parts are joined
    const incomplete = (txt: string) => {
      const p = parseSteps(txt, d.season, yearsList, lang);
      const nSteps = p ? Object.keys(p.steps).length : 0, nYears = p ? Object.keys(p.years).length : 0;
      return nSteps < Math.ceil(d.season.length / 2) || (yearsList.length > 0 && nYears === 0);
    };
    (async () => {
      // queue AFTER "AI analysis": child effects run before the parent's, so wait a moment before calling askAI
      await new Promise((r) => setTimeout(r, 300));
      if (!alive) throw new Error("gone");
      // free routes allow ~1 answer per 45 s per IP and "AI analysis" goes first: on failure wait once, then retry
      const first = await askAI(d.messages, { serverKey }).catch(async () => {
        await new Promise((r) => setTimeout(r, 20000));
        if (!alive) throw new Error("gone");
        return askAI(d.messages, { serverKey });
      });
      let text = clean(first);
      if (text && incomplete(text)) {
        if (alive) setAi({ key, text, state: "loading" });
        const more = await askAI([...d.messages, { role: "assistant", content: text },
          { role: "user", content: "Continue. Write only the missing STEP and YEAR lines, same format." }], { serverKey }).catch(() => "");
        if (more) text = `${text}\n${clean(more)}`;
      }
      return text;
    })()
      .then((c) => { if (c) stepsAiCache.set(key, c); if (alive) setAi({ key, text: c || null, state: c ? "done" : "failed" }); })
      .catch(() => alive && setAi({ key, text: null, state: "failed" }))
      .finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => (ai.text ? parseSteps(ai.text, d.season, d.years.map((y) => y.year), lang) : null), [ai.text, d, lang]);
  const months = (ms: number[]) => ms.map((m) => monthName(m, lang, "short")).join("–");
  const pct = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
  const aiLine = (txt: string | undefined) => (txt ? <p className="text-sm mt-1 rounded-md bg-chalk px-2 py-1" data-step-ai>{txt}</p> : null);

  function values(st: StepItem) {
    const v = st.values;
    switch (st.kind) {
      case "prepare": return t("st.v.prepare", { total: big(v.seed_total_kg as number, 1, lang), rate: big(v.seed_rate_kg_ha as number, 1, lang) });
      case "sow": {
        const dep = v.depth_cm as number[];
        return t("st.v.sow", { d1: dep[0], d2: dep[1], row: v.row_cm as number, score: v.score as number, dry: pct(v.dry_sowing_pct) });
      }
      case "establish": return t("st.v.establish", { pct: pct(v.rain_fail_pct) });
      case "winter": case "frost": return v.frost_pct === null ? t("st.v.nofrost") : t("st.v.frost", { pct: pct(v.frost_pct) });
      case "key": return t("st.v.key", { months: months(v.key_months as number[]), pct: pct(v.dry_key_pct), heat: num(v.heat_days as number | null, 1, false, lang) })
        + (v.dry_spell_next8d_pct !== undefined ? ` · ${t("st.v.key8", { pct: pct(v.dry_spell_next8d_pct) })}` : "");
      case "harvest": return v.harvest_t !== undefined && v.harvest_t !== null
        ? t("st.v.harvest_t", { kgha: big(v.harvest_kg_ha as number, 0, lang), t: num(v.harvest_t as number, 1, false, lang), lo: num(v.harvest_low_t as number, 1, false, lang), hi: num(v.harvest_high_t as number, 1, false, lang) })
        : "";
    }
  }

  return (
    <Card title={t("st.title")}>
      {ai.state === "loading" && (
        <p className="text-moss text-sm flex items-center gap-2 mb-3" data-step-ai-state="loading">
          <span className="inline-block w-2 h-2 rounded-full bg-water animate-pulse" />{t("st.ai_writing")}
        </p>
      )}
      {ai.state === "failed" && <p className="text-moss text-sm mb-3" data-step-ai-state="failed">{t("st.ai_unavailable")}</p>}
      <ol className="relative border-l-2 border-rule ml-2">
        {d.season.map((st, k) => (
          <li key={`${st.kind}-${k}`} className="ml-4 mb-4 last:mb-0">
            <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-canopy border-2 border-panel" aria-hidden />
            <p className="text-sm">
              <b className="capitalize">{st.kind === "harvest" ? months(st.values.typical_months as number[]) : monthName(st.month, lang)}</b>
              {" · "}<span className="font-semibold">{t(`st.k.${st.kind}`)}</span>
              {st.kind === "harvest" && <span className="ml-2 text-xs px-2 py-0.5 rounded-full border border-rule text-moss">{t("st.typical")}</span>}
            </p>
            {values(st) && <p className="text-sm text-moss tabular">{values(st)}</p>}
            {aiLine(parsed?.steps[k])}
          </li>
        ))}
      </ol>

      {d.years.length > 0 && (
        <>
          <p className="mt-5 text-sm font-semibold">{t("st.years")}</p>
          <ul className="mt-2 space-y-2">
            {d.years.map((y) => {
              const tone = y.flag === "ok" ? "green" : y.flag === "watch" ? "yellow" : "red";
              return (
                <li key={y.year} className="text-sm">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full inline-block" style={{ background: LIGHT_COLOR[tone] }} aria-hidden />
                    <b className="tabular">{y.year}</b> · <span className="tabular">{y.score}/100</span> ·{" "}
                    {y.flag === "switch" && y.alternative ? t("st.flag.switch", { alt: `${t(`crop.${y.alternative.crop}`)} (${y.alternative.score}/100)` }) : t(`st.flag.${y.flag}`)}
                  </span>
                  {aiLine(parsed?.years[y.year])}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-moss">{t("st.years_note")}</p>
        </>
      )}
      {ai.state === "done" && ai.text && !parsed && <p className="mt-3 text-sm whitespace-pre-wrap rounded-md bg-chalk px-3 py-2" data-step-ai-whole>{ai.text}</p>}
      {ai.state === "done" && parsed && parsed.rest.length > 0 && <p className="mt-3 text-sm whitespace-pre-wrap rounded-md bg-chalk px-3 py-2" data-step-ai-rest>{parsed.rest.join("\n")}</p>}
      <p className="mt-3 text-xs text-moss">{t("st.note")}</p>
    </Card>
  );
}
