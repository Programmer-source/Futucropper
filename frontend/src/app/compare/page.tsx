"use client";
import { PageHead, Status } from "@/components/bits";
import { TrendRow, useApi } from "@/lib/api";
import { COUNTRY_COLOR, num } from "@/lib/format";
import { useT } from "@/lib/i18n";

type Cmp = {
  summary: { country: string; metric: string; value: number | null; unit: string }[];
  drivers: { country: string; feature: string; importance: number; rank: number }[];
  trends: ({ variable: string; relation?: "shared" | "opposite" | "unclear" } & Partial<Record<"UA" | "AU", TrendRow>>)[];
};
const C = ["UA", "AU"] as const;

export default function Compare() {
  const { t, lang } = useT();
  const { data, error, loading } = useApi<Cmp>("/api/compare");
  if (!data) return <Status loading={loading} error={error} />;
  const v = (c: string, m: string) => data.summary.find((s) => s.country === c && s.metric === m)?.value ?? null;
  const months = (x: number | null) => (x == null ? t("compare.not_recovered") : t("compare.months", { n: x }));
  const rows: [string, (c: string) => string][] = [
    ["compare.effect", (c) => (v(c, "water_loss_effect_pct") == null ? "—" : `${num(v(c, "water_loss_effect_pct"), 0, true, lang)}%`)],
    ["compare.depth", (c) => (v(c, "hit_depth_pct") == null ? "—" : `${num(v(c, "hit_depth_pct"), 0, true, lang)}%`)],
    ["compare.speed", (c) => (v(c, "chain_lag_months") == null ? "—" : t("compare.months", { n: v(c, "chain_lag_months")! }))],
    ["compare.recovery", (c) => months(v(c, "recovery_months"))],
  ];

  return (
    <div>
      <PageHead title={t("compare.title")} />
      {data.summary.length > 0 && (
        <p className="font-display text-xl sm:text-2xl measure mb-10">
          {t("compare.conclusion", {
            au: v("AU", "water_loss_effect_pct") == null ? "—" : `${num(v("AU", "water_loss_effect_pct"), 0, true, lang)}%`,
            ua: v("UA", "water_loss_effect_pct") == null ? "—" : `${num(v("UA", "water_loss_effect_pct"), 0, true, lang)}%`,
          })}
        </p>
      )}

      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b-2 border-basalt">
            <th className="py-2 pr-4 font-normal text-moss w-1/3"><span className="sr-only">metric</span></th>
            {C.map((c) => (
              <th key={c} className="py-2 pr-4 font-display font-semibold">
                <span className="inline-block w-5 h-1 rounded mr-2 align-middle" style={{ background: COUNTRY_COLOR[c] }} aria-hidden />
                {t(`country.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, f]) => (
            <tr key={k} className="border-b border-rule">
              <th scope="row" className="py-3 pr-4 font-normal text-moss">{t(k)}</th>
              {C.map((c) => <td key={c} className="py-3 pr-4 text-lg tabular">{f(c)}</td>)}
            </tr>
          ))}
          <tr className="border-b border-rule align-top">
            <th scope="row" className="py-3 pr-4 font-normal text-moss">{t("compare.drivers")}</th>
            {C.map((c) => (
              <td key={c} className="py-3 pr-4">
                <ol className="list-decimal list-inside space-y-0.5">
                  {data.drivers.filter((d) => d.country === c).map((d) => (
                    <li key={d.feature}>{t(`var.${d.feature}`)} <span className="text-moss tabular">{Math.round(d.importance * 100)}%</span></li>
                  ))}
                </ol>
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {data.trends.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-semibold">{t("compare.shared_title")}</h2>
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {data.trends.filter((r) => r.UA && r.AU).map((r) => (
              <li key={r.variable} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1.2fr_1.2fr_auto] gap-x-4 gap-y-1 py-3 items-baseline">
                <span className="font-semibold">{t(`var.${r.variable}`)}</span>
                {C.map((c) => (
                  <span key={c} className="tabular text-sm" style={{ color: COUNTRY_COLOR[c] }}>
                    {t(`country.${c}`)}: {num(r[c]!.slope_per_decade, 2, true, lang)} / 10
                  </span>
                ))}
                <span className={`text-xs px-2.5 py-1 rounded-full justify-self-start ${r.relation === "opposite" ? "bg-basalt text-white" : r.relation === "unclear" ? "border border-rule text-moss" : "border border-basalt"}`}>
                  {t(`compare.${r.relation}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12 measure">
        <h2 className="text-lg font-semibold">{t("compare.lessons_title")}</h2>
        <p className="mt-3 leading-relaxed">{t("compare.lessons")}</p>
      </section>
    </div>
  );
}
