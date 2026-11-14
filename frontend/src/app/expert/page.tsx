"use client";
import { useMemo, useState } from "react";
import { PageHead, Section, Status } from "@/components/bits";
import { TimeChart } from "@/components/TimeChart";
import { API_URL, EventRow, TrendRow, useApi } from "@/lib/api";
import { COUNTRY_COLOR, fmtDate, num } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useZone, useZoneName } from "@/lib/zone";

/** share as a whole percent; null (e.g. no droughts in the test years) shows a dash */
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
type Skill = { zone: string; country: string; horizon: number; rmse: number; rmse_persistence: number; rmse_climatology: number; class_accuracy: number | null; drought_hit_rate: number | null; coverage80: number | null };
type Sources = { sources: { variable: string; product: string; provider: string; url: string }[]; data_dates: { variable: string; last_date: string }[] };
const FILES = ["series", "trends", "lags", "expected", "forecast", "skill", "importance", "alerts", "summary", "zones", "events", "sources"];

export default function Expert() {
  const { t, list, lang } = useT();
  const { meta, zoneId } = useZone();
  const name = useZoneName();
  const trends = useApi<{ available: boolean; rows: TrendRow[] }>("/api/trends");
  const skill = useApi<{ available: boolean; rows: Skill[] }>("/api/skill");
  const sources = useApi<Sources>("/api/sources");
  const [sort, setSort] = useState<{ k: keyof TrendRow; asc: boolean }>({ k: "p_value_fdr", asc: true });

  const [v, setV] = useState("temp");
  const [z, setZ] = useState(zoneId);
  const [from, setFrom] = useState(meta?.years?.[0] ?? 2003);
  const [to, setTo] = useState(meta?.years?.[1] ?? 2026);
  const series = useApi<{ points: { date: string; value: number }[]; unit: string }>(`/api/zones/${z}/series?variable=${v}&start=${from}&end=${to}`);
  const country = (meta?.zones.find((x) => x.zone === z)?.country ?? "UA") as "UA" | "AU";
  const events = useApi<EventRow[]>(`/api/events?country=${country}`);
  const toolTrend = trends.data?.rows.find((r) => r.zone === z && r.variable === v);

  const rows = useMemo(() => {
    const r = [...(trends.data?.rows ?? [])];
    r.sort((a, b) => {
      const x = a[sort.k] as number | string, y = b[sort.k] as number | string;
      return (x > y ? 1 : x < y ? -1 : 0) * (sort.asc ? 1 : -1);
    });
    return r;
  }, [trends.data, sort]);
  const th = (k: keyof TrendRow, label: string) => (
    <th className="py-2 pr-3 font-semibold whitespace-nowrap">
      <button onClick={() => setSort({ k, asc: sort.k === k ? !sort.asc : true })} className="hover:underline">
        {label}{sort.k === k ? (sort.asc ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  const pfmt = (p: number) => (p < 0.0001 ? "<0" + (lang === "uk" ? "," : ".") + "0001" : num(p, 4, false, lang));
  const years = meta?.years ? Array.from({ length: meta.years[1] - meta.years[0] + 1 }, (_, i) => meta.years![0] + i) : [];

  return (
    <div>
      <PageHead title={t("expert.title")} lead={t("expert.lead")} />

      <Section title={t("expert.tool_title")} help={t("expert.tool_help")} className="mt-0">
        <div className="flex flex-wrap gap-3 items-end text-sm">
          {[
            [t("expert.tool_variable"), v, setV, (meta?.variables ?? []).map((x) => [x, t(`var.${x}`)])],
            [t("expert.tool_zone"), z, setZ, (meta?.zones ?? []).map((x) => [x.zone, `${name(x.zone)} (${t(`country.${x.country}`)})`])],
          ].map(([label, val, set, opts]) => (
            <label key={label as string} className="flex flex-col gap-1">
              <span className="text-moss">{label as string}</span>
              <select value={val as string} onChange={(e) => (set as (s: string) => void)(e.target.value)} className="rounded-lg border border-rule bg-panel px-3 py-2 max-w-[18rem]">
                {(opts as string[][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          ))}
          {[[t("expert.tool_from"), from, setFrom], [t("expert.tool_to"), to, setTo]].map(([label, val, set]) => (
            <label key={label as string} className="flex flex-col gap-1">
              <span className="text-moss">{label as string}</span>
              <select value={val as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} className="rounded-lg border border-rule bg-panel px-3 py-2">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-4 rounded-lg bg-panel border border-rule p-3">
          {series.data?.points?.length ? (
            <TimeChart data={series.data.points} lines={[{ key: "value", label: t(`var.${v}`), color: COUNTRY_COLOR[country], width: 1.4 }]}
              yLabel={t(`unit.${series.data.unit}`)} events={events.data ?? []} height={300} />
          ) : <Status loading={series.loading} error={series.error} empty />}
        </div>
        {toolTrend && (
          <p className="mt-3">
            {t("expert.tool_result", { slope: `${num(toolTrend.slope_per_decade, 3, true, lang)} ${t(`unit.${toolTrend.unit}`)}`, badge: t(`trends.badge.${toolTrend.badge}`).toLowerCase() })}
            <span className="block text-sm text-moss mt-1">{t("expert.tool_note")}</span>
          </p>
        )}
      </Section>

      <Section title={t("expert.trends_title")} help={t("expert.trends_help")}>
        <Status loading={trends.loading} error={trends.error} empty={trends.data ? !trends.data.available : false} />
        {rows.length > 0 && (
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto border border-rule rounded-lg bg-panel">
            <table className="w-full text-sm tabular">
              <thead className="sticky top-0 bg-panel border-b border-rule text-left">
                <tr className="[&>th]:px-3">
                  {th("zone", t("expert.col.zone"))}{th("variable", t("expert.col.variable"))}{th("slope_per_decade", t("expert.col.slope"))}
                  <th className="py-2 pr-3 font-semibold">{t("expert.col.ci")}</th>
                  {th("p_value", t("expert.col.p"))}{th("p_value_fdr", t("expert.col.p_fdr"))}{th("badge", t("expert.col.badge"))}
                  {th("years_to_significance", t("expert.col.years"))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.zone + r.variable} className="border-b border-rule last:border-0 [&>td]:px-3 [&>td]:py-1.5">
                    <td>{name(r.zone)}</td>
                    <td>{t(`var.${r.variable}`)}</td>
                    <td>{num(r.slope_per_decade, 3, true, lang)}</td>
                    <td className="text-moss whitespace-nowrap">{num(r.ci_low, 3, true, lang)} … {num(r.ci_high, 3, true, lang)}</td>
                    <td>{pfmt(r.p_value)}</td>
                    <td className={r.significant ? "font-semibold" : ""}>{pfmt(r.p_value_fdr)}</td>
                    <td>{t(`trends.badge.${r.badge}`)}</td>
                    <td>{r.years_to_significance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("expert.skill_title")} help={t("expert.skill_help")}>
        {skill.data?.rows.length ? (
          <div className="overflow-x-auto border border-rule rounded-lg bg-panel">
            <table className="w-full text-sm tabular">
              <thead className="border-b border-rule text-left">
                <tr className="[&>th]:px-3 [&>th]:py-2">
                  <th>{t("expert.col.zone")}</th><th>{t("expert.col.horizon")}</th><th>{t("expert.col.rmse")}</th>
                  <th>{t("expert.col.persist")}</th><th>{t("expert.col.clim")}</th><th>{t("expert.col.acc")}</th>
                  <th>{t("expert.col.hit")}</th><th>{t("expert.col.cov")}</th>
                </tr>
              </thead>
              <tbody>
                {skill.data.rows.map((r) => (
                  <tr key={r.zone + r.horizon} className="border-b border-rule last:border-0 [&>td]:px-3 [&>td]:py-1.5">
                    <td>{name(r.zone)}</td><td>{t("expert.months", { n: r.horizon })}</td>
                    <td className={r.rmse < r.rmse_persistence ? "font-semibold" : ""}>{num(r.rmse, 2, false, lang)}</td>
                    <td>{num(r.rmse_persistence, 2, false, lang)}</td><td>{num(r.rmse_climatology, 2, false, lang)}</td>
                    <td>{pct(r.class_accuracy)}</td><td>{pct(r.drought_hit_rate)}</td><td>{pct(r.coverage80)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Status loading={skill.loading} error={skill.error} empty />}
      </Section>

      <Section title={t("expert.sources_title")}>
        <table className="w-full text-sm">
          <thead className="text-left border-b border-rule">
            <tr className="[&>th]:pr-4 [&>th]:py-2">
              <th>{t("expert.col.variable")}</th><th>{t("expert.col.product")}</th><th>{t("expert.col.provider")}</th><th>{t("expert.col.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {(sources.data?.sources ?? []).map((s) => {
              const d = sources.data?.data_dates.find((x) => x.variable === s.variable);
              return (
                <tr key={s.variable} className="border-b border-rule [&>td]:pr-4 [&>td]:py-2">
                  <td>{t(`var.${s.variable}`)}</td>
                  <td><a className="underline decoration-rule underline-offset-2 hover:decoration-basalt" href={s.url} target="_blank" rel="noreferrer">{s.product}</a></td>
                  <td>{s.provider}</td>
                  <td className="tabular">{d ? fmtDate(d.last_date, lang) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title={t("expert.downloads_title")}>
        <ul className="flex flex-wrap gap-2">
          {FILES.map((f) => (
            <li key={f}><a href={`${API_URL}/api/download/${f}.csv`} className="inline-block text-sm px-3 py-1.5 rounded-full border border-rule hover:border-basalt bg-panel">{f}.csv</a></li>
          ))}
        </ul>
      </Section>

      <Section title={t("expert.limits_title")}>
        <ul className="list-disc pl-5 space-y-1.5 measure">{list("expert.limits").map((l) => <li key={l}>{l}</li>)}</ul>
      </Section>
    </div>
  );
}
