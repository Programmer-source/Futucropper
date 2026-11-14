"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LightTag, PageHead, Status } from "@/components/bits";
import { ForecastRow, Light, Now, useApi, Zone } from "@/lib/api";
import { LIGHT_COLOR, num } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useZone, useZoneName } from "@/lib/zone";

type Card = {
  zone: Zone; condition: Now["condition"]; light_now: Light; forecast: ForecastRow[];
  alerts: Now["alerts"]; soil_z: number | null; tips: Now["tips"];
};
const WATCH_KEY = "ftg.watch";
const SENT_KEY = "ftg.notified";

function readJSON<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writeJSON(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable: watching lasts for this visit */ }
}

/** What would make a watched zone worth a notification, as stable codes */
function signals(c: Card) {
  const s: string[] = [];
  if (c.light_now === "red") s.push("now_red");
  c.forecast.filter((f) => f.lead_months <= 3).forEach((f) => { if (f.light === "red" || f.light === "yellow") s.push(`fc_${f.lead_months}_${f.light}`); });
  c.alerts.filter((a) => a.active).forEach((a) => s.push(`alert_${a.type}`));
  return s;
}

export default function Dashboard() {
  const { t, list, lang } = useT();
  const { setZoneId } = useZone();
  const name = useZoneName();
  const { data, error, loading } = useApi<{ zones: Card[] }>("/api/dashboard");
  const [watch, setWatch] = useState<string[]>([]);
  const [perm, setPerm] = useState<string>("default");
  const [log, setLog] = useState<string>("");
  useEffect(() => {
    setWatch(readJSON<string[]>(WATCH_KEY, ["UA_main", "AU_main"]));
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  const toggle = (z: string) => setWatch((w) => { const n = w.includes(z) ? w.filter((x) => x !== z) : [...w, z]; writeJSON(WATCH_KEY, n); return n; });

  const check = useCallback((manual: boolean) => {
    if (!data) return;
    const sent = readJSON<Record<string, string>>(SENT_KEY, {});
    let count = 0;
    const lines: string[] = [];
    data.zones.filter((c) => watch.includes(c.zone.zone)).forEach((c) => {
      const sig = signals(c);
      if (!sig.length) return;
      const key = sig.join("|");
      lines.push(`${name(c.zone.zone)}: ${sig.map((x) => t(`dash.sig.${x.replace(/^fc_\d_/, "fc_").replace(/^alert_/, "alert.")}`, {})).join(", ")}`);
      if (!manual && sent[c.zone.zone] === key) return; // already told about this exact situation
      sent[c.zone.zone] = key;
      count++;
      if (perm === "granted") {
        try { new Notification(`Follow the Gas · ${name(c.zone.zone)}`, { body: sig.map((x) => t(`dash.sig.${x.replace(/^fc_\d_/, "fc_").replace(/^alert_/, "alert.")}`, {})).join(" · "), tag: c.zone.zone }); } catch { /* blocked by the browser */ }
      }
    });
    writeJSON(SENT_KEY, sent);
    setLog(lines.length ? lines.join("\n") : t("dash.all_quiet"));
    return count;
  }, [data, watch, perm, name, t]);

  // re-check on load and every 30 minutes while the page is open
  useEffect(() => {
    if (!data) return;
    check(false);
    const id = setInterval(() => check(false), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [data, check]);

  async function enable() {
    if (typeof Notification === "undefined") return;
    try { setPerm(await Notification.requestPermission()); } catch { setPerm("denied"); }
  }

  const M = list("months");
  return (
    <div>
      <PageHead title={t("dash.title")} lead={t("dash.lead")} />

      <div className="rounded-lg bg-panel border border-rule p-4 flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm">{t(`dash.perm.${perm}`)}</span>
        {perm === "default" && <button onClick={enable} className="rounded-full bg-basalt text-white text-sm px-4 py-1.5">{t("dash.enable")}</button>}
        <button onClick={() => check(true)} className="rounded-full border border-rule hover:border-basalt text-sm px-4 py-1.5">{t("dash.check")}</button>
        <span className="text-xs text-moss">{t("dash.watching", { n: watch.length })}</span>
        {log && <pre className="basis-full text-sm whitespace-pre-wrap font-sans text-moss">{log}</pre>}
      </div>

      <Status loading={loading} error={error} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.zones.map((c) => {
          const watched = watch.includes(c.zone.zone);
          const active = c.alerts.filter((a) => a.active);
          return (
            <article key={c.zone.zone} className="rounded-lg bg-panel border border-rule p-4 flex flex-col"
              style={{ borderTop: `4px solid ${c.light_now ? LIGHT_COLOR[c.light_now] : "#ccc"}` }}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-base leading-snug">{name(c.zone.zone)}</h2>
                <button onClick={() => toggle(c.zone.zone)} aria-pressed={watched}
                  className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${watched ? "bg-basalt text-white border-basalt" : "border-rule"}`}>
                  {watched ? t("dash.watched") : t("dash.watch")}
                </button>
              </div>
              <p className="text-xs text-moss">{t(`country.${c.zone.country}`)} · {t(`zonetype.${c.zone.zone_type}`)}</p>
              {c.condition && (
                <p className="mt-3 text-sm">{t("dash.greenness", { month: M[c.condition.month - 1], year: c.condition.date.slice(0, 4), pct: num(c.condition.pct_vs_normal, 0, true, lang) })}</p>
              )}
              <div className="mt-2"><LightTag light={c.light_now} /></div>
              <ul className="mt-3 flex gap-5 text-sm">
                {c.forecast.map((f) => (
                  <li key={f.lead_months}><span className="block text-xs text-moss">{t("now.in_months", { n: f.lead_months })}</span><LightTag light={f.light} /></li>
                ))}
              </ul>
              <p className="mt-3 text-sm">{t("dash.soil", { z: num(c.soil_z, 1, true, lang) })}</p>
              <p className="mt-1 text-sm">{active.length ? active.map((a) => t(`alert.${a.type}`, { value: a.value, pct: a.percentile })).join(" ") : t("alert.none")}</p>
              <div className="mt-auto pt-4 flex gap-3 text-sm">
                <Link href="/now" onClick={() => setZoneId(c.zone.zone)} className="underline">{t("dash.open")}</Link>
                <Link href={`/plan`} onClick={() => setZoneId(c.zone.zone)} className="underline">{t("dash.plan")}</Link>
              </div>
            </article>
          );
        })}
      </div>
      <p className="mt-6 text-xs text-moss measure">{t("dash.note")}</p>
    </div>
  );
}
