"use client";
/** See the Future: one map, a Play button and a slider that steps by SEASON from 2003 to the end of the scenario.
 *  Everything shown is read from /api/future (already-computed files); nothing is recomputed or guessed here.
 *  The "What changed" box asks /api/future/explain only when playback is paused/ended or the slider is dragged. */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, ComposedChart, ErrorBar, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Status } from "@/components/bits";
import { Legend } from "@/components/TimeChart";
import { API_URL, Light, useApi } from "@/lib/api";
import { LIGHT_COLOR, num } from "@/lib/format";
import { LOCALE, monthName, useT } from "@/lib/i18n";
import { gridToDataUrl, zFill } from "@/lib/pixels";
import { useZone, useZoneName } from "@/lib/zone";

const FarmMap = dynamic(() => import("@/components/maps").then((m) => m.FarmMap), { ssr: false });

type Season = "DJF" | "MAM" | "JJA" | "SON";
type Obs = { ndvi_z: number | null; soil_mm: number | null; rain_mm: number | null; temp_c: number | null };
type Fc = { lead_months: number; issue_date: string; target_date: string; predicted: number | null; low: number | null; high: number | null; light: Light };
type Sc = { scenario_mm: number | null; forecast: Fc[] };
type Frame = {
  id: string; year: number; season: Season; kind: "obs" | "fc" | "sc"; gi?: number; si?: number; co2_ppm?: number | null;
  zones: Record<string, Obs | Sc | null>;
};
type FZone = { zone: string; zone_type: string; name_en: string; name_uk: string; lat: number; lon: number; west: number; east: number; south: number; north: number };
type Future = {
  region: "UA" | "AU";
  grid: { west: number; east: number; north: number; south: number; nrows: number; ncols: number };
  resolution: number; source: string; baseline: number[];
  seasons: Record<Season, number[]>;
  observed: { years: number[]; z: Record<Season, (number | null)[][]> };
  zones: FZone[];
  scenario: {
    years: number[]; baseline: string; resolution: number; source: string;
    cells: { lat: number; lon: number }[]; change_mm: Partial<Record<Season, (number | null)[][]>>; co2_ppm: (number | null)[];
  } | null;
  frames: Frame[];
};
type Local = "spring" | "summer" | "autumn" | "winter";

/** Local season names: Ukraine (north) and Australia (south) */
const LOCAL: Record<"UA" | "AU", Record<Season, Local>> = {
  UA: { DJF: "winter", MAM: "spring", JJA: "summer", SON: "autumn" },
  AU: { DJF: "summer", MAM: "autumn", JJA: "winter", SON: "spring" },
};
const MID: Record<Season, number> = { DJF: 0.5 / 12, MAM: 3.5 / 12, JJA: 6.5 / 12, SON: 9.5 / 12 };
const AI_TIMEOUT_MS = 20000;

/** Soil-water change colour, the same scale as the Plan scenario map: brown = less water, blue = more */
function soilFill(v: number | null) {
  if (v === null || Number.isNaN(v)) return null;
  const f = Math.max(-1, Math.min(1, v / 25));
  const mid = [238, 234, 220], dry = [140, 81, 30], wet = [36, 87, 166];
  const end = f < 0 ? dry : wet;
  const c = mid.map((x, k) => Math.round(x + (end[k] - x) * Math.abs(f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function stateKey(z: number | null) {
  if (z === null || Number.isNaN(z)) return null;
  if (z < -1) return "drought";
  if (z < -0.5) return "dry";
  if (z > 0.5) return "lush";
  return "normal";
}

function monthYear(iso: string, lang: string) {
  return new Date(iso.slice(0, 7) + "-15T00:00:00").toLocaleDateString(LOCALE[lang as keyof typeof LOCALE] ?? "en-GB", { month: "short", year: "numeric" });
}

function useSeasonLabel(reg: "UA" | "AU", seasons: Record<Season, number[]> | undefined) {
  const { t, lang } = useT();
  return useCallback((s: Season) => {
    const ms = seasons?.[s] ?? [];
    const range = ms.length ? `${monthName(ms[0], lang, "short")}–${monthName(ms[ms.length - 1], lang, "short")}` : "";
    return `${t(`f.season.${LOCAL[reg][s]}`)} (${range})`;
  }, [reg, seasons, t, lang]);
}

/** One explain request per frame and language: page cache + in-flight dedupe; 20 s timeout -> null (box hides) */
const aiCache = new Map<string, string | null>();
const aiFlight = new Map<string, Promise<string | null>>();
function fetchExplain(reg: string, f: Frame, lang: string): Promise<string | null> {
  const key = `${reg}|${f.year}|${f.season}|${lang}`;
  if (aiCache.has(key)) return Promise.resolve(aiCache.get(key) ?? null);
  const running = aiFlight.get(key);
  if (running) return running;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), AI_TIMEOUT_MS);
  const p = fetch(`${API_URL}/api/future/explain?region=${reg}&year=${f.year}&season=${f.season}&lang=${lang}`, { signal: ctl.signal })
    .then((r) => (r.ok ? r.json() : { text: null }))
    .then((j: { text: string | null }) => { const v = j.text || null; if (v) aiCache.set(key, v); return v; })
    .catch(() => null)
    .finally(() => { clearTimeout(timer); aiFlight.delete(key); });
  aiFlight.set(key, p);
  return p;
}

export default function FuturePage() {
  const { t, lang } = useT();
  const { meta } = useZone();
  const name = useZoneName();
  const [reg, setReg] = useState<"UA" | "AU">("UA");
  const fut = useApi<Future>(`/api/future?region=${reg}`);
  const d = fut.data && fut.data.region === reg ? fut.data : null;
  const seasonLabel = useSeasonLabel(reg, d?.seasons);

  const [only, setOnly] = useState<Local | null>(null);
  const steps = useMemo(() => (d?.frames ?? []).filter((f) => !only || LOCAL[reg][f.season] === only), [d, only, reg]);

  const [i, setI] = useState(0);
  const [play, setPlay] = useState(false);
  const [dragged, setDragged] = useState(0); // bumps on every slider drag, so the AI waits for the drag to settle
  const [armed, setArmed] = useState(false); // the AI is asked only after a pause, a drag or the end of playback
  useEffect(() => { setI(0); setPlay(false); setArmed(false); }, [reg]);
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => setI((x) => {
      if (x + 1 >= steps.length) { setPlay(false); setArmed(true); return x; }
      return x + 1;
    }), 500);
    return () => clearInterval(id);
  }, [play, steps.length]);
  const step = steps[Math.min(i, Math.max(0, steps.length - 1))] as Frame | undefined;

  function chooseOnly(o: Local | null) {
    const year = step?.year ?? 0;
    const next = (d?.frames ?? []).filter((f) => !o || LOCAL[reg][f.season] === o);
    const k = next.findIndex((f) => f.year >= year);
    setOnly(o);
    setPlay(false);
    setI(k < 0 ? 0 : k);
  }

  const [zoneId, setZoneId] = useState<string | null>(null);
  useEffect(() => setZoneId(null), [reg]);
  const zone = d ? d.zones.find((z) => z.zone === zoneId) ?? d.zones.find((z) => z.zone === `${reg}_main`) ?? d.zones[0] ?? null : null;
  const mapZones = (meta?.zones ?? []).filter((z) => z.country === reg);

  // land mask from the observed grids, so the 25 km scenario is painted on land only (null = water)
  const landMask = useMemo(() => {
    if (!d) return null;
    const m = new Array<boolean>(d.grid.nrows * d.grid.ncols).fill(false);
    Object.values(d.observed.z).forEach((years) => years.forEach((g) => g.forEach((v, k) => { if (v !== null) m[k] = true; })));
    return m;
  }, [d]);

  const image = useMemo(() => {
    if (!d || !step || typeof document === "undefined") return null;
    const { nrows, ncols, north, west } = d.grid;
    if (step.kind === "obs") {
      const g = d.observed.z[step.season]?.[step.gi ?? -1];
      return g ? gridToDataUrl(g.map((v) => (v === null ? null : v / 10)), nrows, ncols, zFill) : null;
    }
    const ch = d.scenario?.change_mm[step.season];
    if (!d.scenario || !ch || step.si === undefined) return null;
    const si = step.si, res = d.scenario.resolution;
    const byCell = new Map<string, number | null>();
    d.scenario.cells.forEach((c, k) => byCell.set(`${Math.floor(c.lat / res)},${Math.floor(c.lon / res)}`, ch[k]?.[si] ?? null));
    const vals: (number | null)[] = [];
    for (let r = 0; r < nrows; r++) {
      for (let c = 0; c < ncols; c++) {
        const k = r * ncols + c;
        if (landMask && !landMask[k]) { vals.push(null); continue; }
        const lat = north - (r + 0.5) * d.resolution, lon = west + (c + 0.5) * d.resolution;
        const v = byCell.get(`${Math.floor(lat / res)},${Math.floor(lon / res)}`);
        vals.push(v === undefined ? null : v);
      }
    }
    return gridToDataUrl(vals, nrows, ncols, soilFill);
  }, [d, step, landMask]);

  const bounds: [[number, number], [number, number]] | null = d ? [[d.grid.south, d.grid.west], [d.grid.north, d.grid.east]] : null;
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    mapZones.forEach((z) => { out[z.zone] = name(z.zone); });
    return out;
  }, [mapZones, name]);
  const lights = useMemo(() => {
    const out: Record<string, Light> = {};
    if (zone) out[zone.zone] = "green";
    return out;
  }, [zone]);

  function pick(lat: number, lon: number) {
    const hit = d?.zones.find((z) => lat >= z.south && lat <= z.north && lon >= z.west && lon <= z.east);
    if (hit) setZoneId(hit.zone);
  }

  // ---- AI "What changed": never during playback; after pause / drag / end, then prefetch the next 2 frames ----
  const [ai, setAi] = useState<{ id: string; text: string | null; loading: boolean } | null>(null);
  const aiFor = useRef("");
  useEffect(() => {
    if (play || !armed || !step || !d) { setAi(null); return; }
    const key = `${reg}|${step.id}|${lang}`;
    aiFor.current = key;
    const cached = aiCache.get(`${reg}|${step.year}|${step.season}|${lang}`);
    if (cached) { setAi({ id: key, text: cached, loading: false }); }
    else setAi({ id: key, text: null, loading: true });
    const wait = setTimeout(async () => {
      const text = await fetchExplain(reg, step, lang);
      if (aiFor.current !== key) return;
      setAi({ id: key, text, loading: false });
      for (const n of steps.slice(i + 1, i + 3)) {
        if (aiFor.current !== key) break;
        await fetchExplain(reg, n, lang);
      }
    }, cached ? 0 : 350);
    return () => clearTimeout(wait);
  }, [play, armed, step, d, reg, lang, dragged]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold">{t("f.title")}</h1>
      <p className="measure mt-2 text-moss">{t("f.lead")}</p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(["UA", "AU"] as const).map((r) => (
          <button key={r} onClick={() => setReg(r)} aria-pressed={reg === r}
            className={`px-4 py-2 rounded-full border ${reg === r ? "bg-basalt text-white border-basalt" : "border-rule bg-panel hover:border-basalt"}`}>{t(`country.${r}`)}</button>
        ))}
        <span className="w-px h-6 bg-rule mx-2" aria-hidden />
        {d?.zones.map((z) => (
          <button key={z.zone} onClick={() => setZoneId(z.zone)} aria-pressed={zone?.zone === z.zone}
            className={`text-sm px-3 py-1.5 rounded-full border ${zone?.zone === z.zone ? "bg-canopy text-white border-canopy" : "border-rule bg-panel hover:border-basalt"}`}>{name(z.zone)}</button>
        ))}
      </div>

      <Status loading={fut.loading} error={fut.error} />

      {d && bounds && step && (
        <div className="mt-4 grid lg:grid-cols-[1fr_360px] gap-5">
          <div>
            <FarmMap bounds={bounds} image={image} zones={mapZones} lights={lights} labels={labels} picked={null} onPick={pick} />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-moss">
              {step.kind === "obs" ? (
                <>
                  <span>{t("f.leg_dry")} {num(-2.5, 1, false, lang)}</span>
                  <span className="flex h-3 w-40 rounded overflow-hidden">{[-2.5, -1.25, 0, 1.25, 2.5].map((v) => <span key={v} className="flex-1" style={{ background: zFill(v) ?? "#ccc" }} />)}</span>
                  <span>{num(2.5, 1, true, lang)} {t("f.leg_green")}</span>
                </>
              ) : (
                <>
                  <span>{t("f.leg_less")} −25 mm</span>
                  <span className="flex h-3 w-40 rounded overflow-hidden">{[-25, -12, 0, 12, 25].map((v) => <span key={v} className="flex-1" style={{ background: soilFill(v) ?? "#ccc" }} />)}</span>
                  <span>+25 mm {t("f.leg_more")}</span>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-moss measure">
              {step.kind === "obs" ? t("f.map_obs", { season: `${step.year} · ${seasonLabel(step.season)}` }) : t("f.map_sc", { season: `${step.year} · ${seasonLabel(step.season)}` })}
              {" "}{t("f.click_zone")}
            </p>
          </div>

          <aside className="self-start">
            <section className="rounded-lg bg-panel border border-rule p-4 sm:p-5 mb-4">
              <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
                <span className="text-moss mr-1">{t("f.show_only")}</span>
                {([null, "spring", "summer", "autumn", "winter"] as const).map((o) => (
                  <button key={o ?? "all"} onClick={() => chooseOnly(o)} aria-pressed={only === o}
                    className={`px-2.5 py-1 rounded-full border ${only === o ? "bg-basalt text-white border-basalt" : "border-rule bg-panel hover:border-basalt"}`}>{o ? t(`f.season.${o}`) : t("f.all")}</button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => { if (play) setArmed(true); if (!play && i >= steps.length - 1) setI(0); setPlay((p) => !p); }}
                  className="rounded-full bg-basalt text-white w-10 h-10 shrink-0" aria-label={play ? t("f.pause") : t("f.play")}>{play ? "❚❚" : "▶"}</button>
                <input type="range" min={0} max={steps.length - 1} value={Math.min(i, steps.length - 1)}
                  onChange={(e) => { setPlay(false); setI(Number(e.target.value)); setArmed(true); setDragged((x) => x + 1); }}
                  className="flex-1" aria-label={`${step.year} · ${seasonLabel(step.season)}`} />
              </div>
              <p className="mt-2 font-semibold tabular">{step.year} · {seasonLabel(step.season)}</p>
              <div className="mt-0.5 flex justify-between text-xs text-moss tabular">
                <span>{steps[0]?.year}</span><span>{steps[steps.length - 1]?.year}</span>
              </div>
              {zone && <FrameCard d={d} zone={zone} step={step} label={seasonLabel(step.season)} />}
              {ai && (ai.loading || ai.text) && (
                <div className="mt-3 rounded-md border border-rule px-3 py-2 text-sm" aria-live="polite" data-ai-box>
                  <p className="text-xs font-semibold mb-1">{t("f.ai_title")}</p>
                  {ai.loading ? <p className="text-moss text-xs">{t("f.ai_loading")}</p> : <p>{ai.text}</p>}
                  <p className="mt-1 text-[11px] text-moss">{t("f.ai_note")}</p>
                </div>
              )}
            </section>
          </aside>
        </div>
      )}

      {d && zone && step && (
        <section className="rounded-lg bg-panel border border-rule p-4 sm:p-5 mt-5">
          <h3 className="font-semibold mb-3">{t("f.chart", { zone: name(zone.zone) })}</h3>
          <ZoneChart d={d} zone={zone} frames={steps} cursor={step.year + MID[step.season] - (step.season === "DJF" ? 1 / 12 : 0)} />
          <Legend items={[
            { label: t("f.c.obs"), color: "var(--color-canopy)" },
            { label: t("f.c.fc"), color: "var(--color-water)" },
            { label: t("f.c.sc"), color: "#8c511e", dash: true },
          ]} />
          <p className="mt-2 text-xs text-moss measure">{t("f.yearly_note")} {t("f.kind.sc")}: {t("f.sc_note")}.</p>
        </section>
      )}
    </div>
  );
}

function FrameCard({ d, zone, step, label }: { d: Future; zone: FZone; step: Frame; label: string }) {
  const { t, lang } = useT();
  const name = useZoneName();
  const green = (z: number | null | undefined) => {
    const v = z ?? null;
    const s = stateKey(v);
    return `${num(v, 1, true, lang)}${s ? ` (${t(`f.st.${s}`)})` : ""}`;
  };
  const kindTag = (k: "obs" | "fc" | "sc") => (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white mr-1"
      style={{ background: k === "obs" ? "var(--color-canopy)" : k === "fc" ? "var(--color-water)" : "#8c511e" }}>{t(`f.kind.${k}`)}</span>
  );
  const head = <b className="tabular">{step.year} · {label}</b>;

  const lines: React.ReactNode[] = [];
  if (step.kind === "obs") {
    const y = step.zones[zone.zone] as Obs | null;
    lines.push(<>{head} · {kindTag("obs")} · {t("f.green")} <b className="tabular">{green(y?.ndvi_z)}</b> · {t("f.soil")} <b className="tabular">{num(y?.soil_mm ?? null, 0, false, lang)} mm</b> · {t("f.rain")} <b className="tabular">{num(y?.rain_mm ?? null, 0, false, lang)} mm</b> · {t("f.temp")} <b className="tabular">{num(y?.temp_c ?? null, 1, false, lang)} °C</b></>);
  } else {
    const z = step.zones[zone.zone] as Sc | null;
    if (step.kind === "fc") {
      lines.push(<>{head} · {kindTag("fc")} {(z?.forecast ?? []).length ? z!.forecast.map((f, k) => (
        <span key={f.lead_months}>{k > 0 && " · "}<b className="tabular">{monthYear(f.target_date, lang)}</b>: {t("f.green")} <b className="tabular" style={{ color: f.light ? LIGHT_COLOR[f.light] : undefined }}>{green(f.predicted)}</b> <span className="text-moss">({t("f.range", { lo: num(f.low, 1, true, lang), hi: num(f.high, 1, true, lang) })})</span></span>
      )) : "—"}</>);
    }
    lines.push(<>{step.kind === "sc" && <>{head} · </>}{kindTag("sc")} · {t("f.soil")} <b className="tabular">{num(z?.scenario_mm ?? null, 1, true, lang)} mm</b> {t("f.vs_base")} · CO₂ <b className="tabular">{num(step.co2_ppm ?? null, 0, false, lang)} ppm</b> <span className="text-moss text-xs">({t("f.sc_note")})</span></>);
  }
  return (
    <div className="mt-4 rounded-md bg-chalk px-3 py-2 text-sm" data-frame-card>
      <p className="text-xs text-moss mb-1">{name(zone.zone)}</p>
      {lines.map((l, k) => <p key={k} className={k ? "mt-1" : ""}>{l}</p>)}
    </div>
  );
}

function ZoneChart({ d, zone, frames, cursor }: { d: Future; zone: FZone; frames: Frame[]; cursor: number }) {
  const { t, lang } = useT();
  const data = useMemo(() => {
    const rows: Record<string, number | null | number[]>[] = [];
    frames.forEach((f) => {
      const x = f.year + MID[f.season] - (f.season === "DJF" ? 1 / 12 : 0);
      if (f.kind === "obs") {
        rows.push({ x, obs: (f.zones[zone.zone] as Obs | null)?.ndvi_z ?? null });
      } else {
        const z = f.zones[zone.zone] as Sc | null;
        rows.push({ x, sc: z?.scenario_mm ?? null });
        (z?.forecast ?? []).forEach((fc) => {
          const dt = new Date(fc.target_date + "T00:00:00");
          rows.push({ x: dt.getFullYear() + (dt.getMonth() + 0.5) / 12, fc: fc.predicted,
            fcErr: fc.predicted !== null && fc.low !== null && fc.high !== null ? [fc.predicted - fc.low, fc.high - fc.predicted] : null });
        });
      }
    });
    return rows.sort((a, b) => (a.x as number) - (b.x as number));
  }, [frames, zone]);
  const last = d.scenario?.years[d.scenario.years.length - 1] ?? 2035;

  return (
    <div style={{ height: 320 }} className="w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#e3e7e1" vertical={false} />
          <XAxis dataKey="x" type="number" domain={[2003 - 1 / 12, last + 1]} ticks={[2003, 2006, 2009, 2012, 2015, 2018, 2021, 2024, 2027, 2030, 2033, 2036]}
            tickFormatter={(v: number) => String(Math.floor(v))} tick={{ fontSize: 12, fill: "#56655d" }} />
          <YAxis yAxisId="z" tick={{ fontSize: 12, fill: "#56655d" }} width={52} tickFormatter={(v: number) => num(v, 1, false, lang)}
            label={{ value: t("f.axis_z"), angle: -90, position: "insideLeft", style: { fontSize: 12, fill: "#56655d" }, offset: 8 }} />
          <YAxis yAxisId="mm" orientation="right" tick={{ fontSize: 12, fill: "#8c511e" }} width={52} tickFormatter={(v: number) => num(v, 1, false, lang)}
            label={{ value: t("f.axis_mm"), angle: 90, position: "insideRight", style: { fontSize: 12, fill: "#8c511e" }, offset: 8 }} />
          <Tooltip
            formatter={(v, n) => (Array.isArray(v) ? null : [typeof v === "number" ? num(v, 1, true, lang) : String(v), n])}
            labelFormatter={(x) => String(Math.floor(Number(x)))}
            contentStyle={{ borderRadius: 8, border: "1px solid #d6dbd3", fontSize: 13 }}
          />
          <ReferenceLine yAxisId="z" y={0} stroke="#d6dbd3" />
          <ReferenceLine yAxisId="z" x={cursor} stroke="#18231f" strokeDasharray="3 3" />
          <Line yAxisId="z" dataKey="obs" name={t("f.c.obs")} stroke="var(--color-canopy)" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
          <Line yAxisId="z" dataKey="fc" name={t("f.c.fc")} stroke="none" isAnimationActive={false} legendType="none"
            dot={{ r: 5, fill: "var(--color-water)", stroke: "#fff", strokeWidth: 1.5 }}>
            <ErrorBar dataKey="fcErr" width={6} stroke="var(--color-water)" direction="y" />
          </Line>
          <Line yAxisId="mm" dataKey="sc" name={t("f.c.sc")} stroke="#8c511e" strokeWidth={1.6} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
