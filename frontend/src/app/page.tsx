"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AIText, useAI } from "@/components/AIBox";
import { Status } from "@/components/bits";
import { get, Light, useApi } from "@/lib/api";
import { num } from "@/lib/format";
import { monthName, useT } from "@/lib/i18n";
import { Msg } from "@/lib/llm";
import { gridToDataUrl, PixelMaps, scoreColor } from "@/lib/pixels";
import { useZone, useZoneName } from "@/lib/zone";

const FarmMap = dynamic(() => import("@/components/maps").then((m) => m.FarmMap), { ssr: false });

type Options = Record<string, { country: "UA" | "AU"; sow: number[]; window: string; irrigated_only: boolean }>;
type Ranking = { ranking: { zone: string; best_score: number; best_month: number }[] };
type Dash = { zones: { zone: { zone: string }; light_now: Light }[] };
type Spot = {
  zone: { zone: string; name_en: string }; inside_zone: boolean;
  cell: { best_land: number | null; mean_ndvi: number | null; poor_years: number[]; n_years: number } | null;
  crops: { crop: string; best_month: number; score: number; needs_irrigation: boolean; land_score: number | null }[];
  dry_spell_next8d_pct: number | null; soil_trend_mm_per_decade: number | null; messages: Msg[];
};

export default function MapPage() {
  const { t, lang } = useT();
  const { meta } = useZone();
  const name = useZoneName();
  const maps = useApi<PixelMaps>("/api/pixels");
  const opts = useApi<Options>("/api/advisor/options");
  const dash = useApi<Dash>("/api/dashboard");
  const [reg, setReg] = useState<"UA" | "AU">("UA");
  const crops = useMemo(() => Object.entries(opts.data ?? {}).filter(([, v]) => v.country === reg).map(([k]) => k), [opts.data, reg]);
  const [crop, setCrop] = useState("winter_wheat");
  useEffect(() => { if (crops.length && !crops.includes(crop)) setCrop(crops[0]); }, [crops, crop]);
  const zones = (meta?.zones ?? []).filter((z) => z.country === reg);
  const rank = useApi<Ranking>(opts.data?.[crop] && zones[0] ? `/api/advisor?crop=${crop}&zone=${zones[0].zone}` : null);

  const region = maps.data?.regions[reg] ?? null;
  const win = region?.windows.find((w) => w.id === opts.data?.[crop]?.window) ?? region?.windows.find((w) => w.id === "season") ?? null;
  const image = useMemo(() => (region && win && typeof document !== "undefined" ? gridToDataUrl(win.best_land, region.nrows, region.ncols, scoreColor) : null), [region, win]);
  const bounds: [[number, number], [number, number]] | null = region ? [[region.south, region.west], [region.north, region.east]] : null;
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    rank.data?.ranking.forEach((r) => { out[r.zone] = t("m.zone_label", { month: monthName(r.best_month, lang, "short"), score: r.best_score }); });
    return out;
  }, [rank.data, t, lang]);
  const lights = useMemo(() => {
    const out: Record<string, Light> = {};
    dash.data?.zones.forEach((z) => { out[z.zone.zone] = z.light_now; });
    return out;
  }, [dash.data]);

  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => setPicked(null), [reg]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [q, setQ] = useState("");
  const [askMsgs, setAskMsgs] = useState<Msg[] | null>(null);
  useEffect(() => {
    setSpot(null); setAskMsgs(null);
    if (!picked) return;
    let alive = true;
    get<Spot>(`/api/spot?lat=${picked.lat.toFixed(4)}&lon=${picked.lon.toFixed(4)}&lang=${lang}`).then((s) => alive && setSpot(s)).catch(() => {});
    return () => { alive = false; };
  }, [picked, lang]);
  const ai = useAI(askMsgs);
  async function ask() {
    if (!picked) return;
    const s = await get<Spot>(`/api/spot?lat=${picked.lat.toFixed(4)}&lon=${picked.lon.toFixed(4)}&lang=${lang}&q=${encodeURIComponent(q)}`);
    setAskMsgs(s.messages);
  }
  const here = spot?.crops.find((c) => c.crop === crop);

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-semibold">{t("m.title")}</h1>
      <p className="measure mt-2 text-moss">{t("m.lead")}</p>
      <Status loading={maps.loading} error={maps.error} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(["UA", "AU"] as const).map((r) => (
          <button key={r} onClick={() => setReg(r)} aria-pressed={reg === r}
            className={`px-4 py-2 rounded-full border ${reg === r ? "bg-basalt text-white border-basalt" : "border-rule bg-panel hover:border-basalt"}`}>{t(`country.${r}`)}</button>
        ))}
        <span className="w-px h-6 bg-rule mx-2" aria-hidden />
        {crops.map((c) => (
          <button key={c} onClick={() => setCrop(c)} aria-pressed={crop === c}
            className={`text-sm px-3 py-1.5 rounded-full border ${crop === c ? "bg-canopy text-white border-canopy" : "border-rule bg-panel hover:border-basalt"}`}>{t(`crop.${c}`)}</button>
        ))}
      </div>

      {bounds && (
        <div className="mt-4 grid lg:grid-cols-[1fr_340px] gap-5">
          <div>
            <FarmMap bounds={bounds} image={image} zones={zones} lights={lights} labels={labels} picked={picked} onPick={(lat, lon) => setPicked({ lat, lon })} />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-moss">
              <span>{t("m.legend_lo")}</span>
              <span className="flex h-3 w-40 rounded overflow-hidden">{[0, 25, 50, 75, 100].map((s) => <span key={s} className="flex-1" style={{ background: scoreColor(s) ?? "#ccc" }} />)}</span>
              <span>{t("m.legend_hi")}</span>
            </div>
            <p className="mt-1 text-xs text-moss measure">{t("m.outline")} {t("m.how")}</p>
          </div>

          <aside className="rounded-lg bg-panel border border-rule p-4 self-start">
            {!picked && <p className="text-moss">{t("m.click_hint")}</p>}
            {picked && !spot && <p className="text-moss text-sm">{t("state.loading")}</p>}
            {picked && spot && (
              <>
                <p className="text-xs text-moss tabular">{t("m.here")} · {num(picked.lat, 3, false, lang)}°, {num(picked.lon, 3, false, lang)}°</p>
                <p className="text-sm mt-1">{spot.inside_zone ? t("m.inside", { zone: name(spot.zone.zone) }) : t("m.nearest", { zone: name(spot.zone.zone) })}</p>
                {spot.cell ? (
                  <>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular">{here?.land_score ?? spot.cell.best_land ?? "—"}</span>
                      <span className="text-moss">/100 · {t("m.land")} · {t(`crop.${crop}`)}</span>
                    </div>
                    <p className="text-sm mt-1">{t("m.greenness")}: <b className="tabular">{num(spot.cell.mean_ndvi, 2, false, lang)}</b></p>
                    <p className="text-sm mt-1">{spot.cell.poor_years.length ? t("m.poor", { years: spot.cell.poor_years.join(", ") }) : t("m.no_poor")}</p>
                  </>
                ) : <p className="mt-2 text-sm">{t("m.water")}</p>}

                <p className="mt-4 text-xs text-moss">{t("m.best_crops")}</p>
                <ul className="mt-1 text-sm space-y-0.5">
                  {spot.crops.map((c) => (
                    <li key={c.crop} className={`flex justify-between gap-2 ${c.crop === crop ? "font-semibold" : ""}`}>
                      <span>{t(`crop.${c.crop}`)}{c.needs_irrigation && <span className="text-moss text-xs"> · {t("m.irr_only")}</span>}</span>
                      <span className="tabular">{c.score} · {monthName(c.best_month, lang, "short")}</span>
                    </li>
                  ))}
                </ul>
                {spot.dry_spell_next8d_pct !== null && <p className="mt-3 text-sm">{t("m.dry8", { pct: spot.dry_spell_next8d_pct })}</p>}
                {spot.soil_trend_mm_per_decade !== null && <p className="mt-1 text-sm">{t("m.soil_trend", { v: num(spot.soil_trend_mm_per_decade, 1, true, lang) })}</p>}

                <Link href={`/plan?lat=${picked.lat.toFixed(4)}&lon=${picked.lon.toFixed(4)}&crop=${crop}`}
                  className="mt-4 block text-center rounded-full bg-basalt text-white px-4 py-2">{t("m.plan_here")}</Link>

                <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="mt-4 border-t border-rule pt-4">
                  <label className="text-sm font-semibold" htmlFor="spotq">{t("m.ask")}</label>
                  <div className="mt-2 flex gap-2">
                    <input id="spotq" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("m.ask_ph")} maxLength={400}
                      className="flex-1 min-w-0 rounded-lg border border-rule px-3 py-2 text-sm" />
                    <button type="submit" disabled={ai.busy} className="rounded-lg border border-basalt px-3 py-2 text-sm disabled:opacity-40">AI</button>
                  </div>
                  <div className="mt-3 text-sm"><AIText ai={ai} /></div>
                </form>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
