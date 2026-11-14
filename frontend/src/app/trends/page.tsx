"use client";
import { useState } from "react";
import { PageHead, Status } from "@/components/bits";
import { TimeChart } from "@/components/TimeChart";
import { EventRow, TrendRow, useApi } from "@/lib/api";
import { COUNTRY_COLOR, COUNTRY_DASH, num } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useZone, useZoneName } from "@/lib/zone";

const KEY_VARS = ["temp", "heat_days_30", "precip", "dry_spell_max", "soil_moisture", "ndvi", "vpd", "evap", "grace_tws"];
const BADGE_STYLE = {
  confirmed: "bg-basalt text-white",
  possible: "border border-basalt",
  none: "border border-rule text-moss",
} as const;

export default function Trends() {
  const { t, lang } = useT();
  const { zoneId, zone } = useZone();
  const name = useZoneName();
  const [pick, setPick] = useState("temp");
  const tr = useApi<{ available: boolean; rows: TrendRow[] }>(`/api/trends?zone=${zoneId}`);
  const series = useApi<{ points: { date: string; value: number }[]; unit: string }>(`/api/zones/${zoneId}/series?variable=${pick}`);
  const events = useApi<EventRow[]>(`/api/events?country=${zone?.country ?? "UA"}`);

  const rows = (tr.data?.rows ?? []).filter((r) => KEY_VARS.includes(r.variable))
    .sort((a, b) => KEY_VARS.indexOf(a.variable) - KEY_VARS.indexOf(b.variable));
  const country = (zone?.country ?? "UA") as "UA" | "AU";

  return (
    <div>
      <PageHead title={t("trends.title")} lead={t("trends.lead", { zone: name(zoneId) })} />
      <Status loading={tr.loading} error={tr.error} empty={tr.data ? !tr.data.available : false} />

      <ul className="divide-y divide-rule border-y border-rule">
        {rows.map((r) => {
          const arrow = r.badge === "none" ? "→" : r.slope_per_decade > 0 ? "↗" : "↘";
          return (
            <li key={r.variable}>
              <button onClick={() => setPick(r.variable)}
                className={`w-full text-left grid grid-cols-[2rem_1fr] sm:grid-cols-[2rem_1.2fr_1fr_auto] gap-x-4 gap-y-1 py-4 px-1 items-baseline hover:bg-panel ${pick === r.variable ? "bg-panel" : ""}`}
                aria-pressed={pick === r.variable}>
                <span className="font-display text-xl" aria-hidden>{arrow}</span>
                <span className="font-semibold">{t(`var.${r.variable}`)}</span>
                <span className="tabular col-start-2 sm:col-start-auto">
                  {t("trends.per_decade", { value: num(r.slope_per_decade, Math.abs(r.slope_per_decade) < 0.1 ? 3 : 2, true, lang), unit: t(`unit.${r.unit}`) })}
                </span>
                <span className={`col-start-2 sm:col-start-auto justify-self-start text-xs px-2.5 py-1 rounded-full ${BADGE_STYLE[r.badge]}`}>
                  {t(`trends.badge.${r.badge}`)}
                </span>
                <span className="col-start-2 sm:col-start-2 sm:col-end-5 text-sm text-moss">
                  {t(`trends.meaning.${r.badge}`)}
                  {!r.significant && r.years_to_significance ? ` ${t("trends.years_to", { n: r.years_to_significance })}.` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t("trends.chart_title", { var: t(`var.${pick}`), zone: name(zoneId) })}</h2>
        <div className="mt-4 rounded-lg bg-panel border border-rule p-3">
          {series.data?.points?.length ? (
            <TimeChart
              data={series.data.points}
              lines={[{ key: "value", label: t(`var.${pick}`), color: COUNTRY_COLOR[country], dash: COUNTRY_DASH[country] === "0" ? undefined : COUNTRY_DASH[country], width: 1.4 }]}
              yLabel={t(`unit.${series.data.unit}`)}
              events={events.data ?? []}
            />
          ) : (
            <Status loading={series.loading} error={series.error} empty />
          )}
        </div>
      </section>
    </div>
  );
}
