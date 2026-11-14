"use client";
import dynamic from "next/dynamic";
import { LightTag, Status } from "@/components/bits";
import { FieldStrip } from "@/components/FieldStrip";
import { Alerts, DataDates, Tips, WhyChain } from "@/components/NowParts";
import { Now, useApi } from "@/lib/api";
import { LIGHT_COLOR, num } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useZone, useZoneName } from "@/lib/zone";

const ZoneMap = dynamic(() => import("@/components/ZoneMap"), { ssr: false });

export default function FieldsNow() {
  const { t, list, lang } = useT();
  const { meta, zoneId, zone, setZoneId } = useZone();
  const name = useZoneName();
  const { data, error, loading } = useApi<Now>(zoneId ? `/api/zones/${zoneId}/now` : null);

  if (!data || !meta) return <Status loading={loading || !meta} error={error} />;
  const c = data.condition;
  const pct = c ? Math.round(c.pct_vs_normal) : 0;
  const month = c ? list("months_in")[c.month - 1] : "";
  const sentence = !c ? "" : Math.abs(pct) < 3 ? t("now.same", { zone: name(zoneId), month })
    : pct < 0 ? t("now.less", { zone: name(zoneId), pct: Math.abs(pct), month })
    : t("now.more", { zone: name(zoneId), pct, month });
  const near = data.forecast.filter((f) => f.lead_months <= 3);
  const shown = data.forecast.filter((f) => f.lead_months <= 3 || f.beats_baseline);
  const hidden6 = data.forecast.some((f) => f.lead_months > 3 && !f.beats_baseline);
  const acc = data.skill.find((s) => s.horizon === 1)?.class_accuracy;
  const countryZones = meta.zones.filter((z) => z.country === zone?.country);

  return (
    <div>
      <div className="grid md:grid-cols-[1.45fr_1fr] gap-8 items-stretch">
        <div>
          {c ? (
            <>
              <p className="font-display text-[1.7rem] sm:text-[2.25rem] leading-[1.15] font-medium measure">
                <span className="inline-block w-3.5 h-3.5 rounded-full mr-3 align-middle -translate-y-1"
                  style={{ background: data.light_now ? LIGHT_COLOR[data.light_now] : "#ccc" }} aria-hidden />
                {sentence}
              </p>
              <p className="mt-3 text-sm text-moss tabular">
                {t("now.measured", { month: list("months")[c.month - 1], year: c.date.slice(0, 4), z: num(c.ndvi_z, 2, true, lang) })}
              </p>
            </>
          ) : (
            <Status empty />
          )}

          <div className="mt-8">
            <h2 className="text-base font-semibold">{t("now.outlook")}</h2>
            <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              {shown.map((f) => (
                <li key={f.lead_months} className="flex flex-col">
                  <span className="text-sm text-moss">
                    {t("now.in_months", { n: f.lead_months })}, {list("months")[new Date(f.target_date + "T00:00:00").getMonth()]}
                  </span>
                  <LightTag light={f.light} size="lg" />
                </li>
              ))}
            </ul>
            {acc !== undefined && near.length > 0 && (
              <p className="mt-3 text-sm text-moss">{t("now.skill", { n: Math.round(acc * 10) })}</p>
            )}
            {hidden6 && <p className="mt-1 text-sm text-moss">{t("now.no6")}</p>}
            <p className="mt-1 text-sm text-moss measure">{t("now.data_note")}</p>
          </div>
        </div>

        <div className="flex flex-col">
          <ZoneMap zones={countryZones} selected={zoneId} onSelect={setZoneId} names={name} />
          <p className="mt-2 text-xs text-moss">{t("now.map_caption")}</p>
        </div>
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold">{t("now.strip_title")}</h2>
        <div className="mt-4 rounded-lg bg-panel border border-rule p-3 sm:p-5 overflow-x-auto">
          <div className="min-w-[620px]"><FieldStrip now={data} thresholds={meta.thresholds} /></div>
        </div>
      </section>

      <div className="mt-12 grid lg:grid-cols-3 gap-x-10 gap-y-10">
        <section>
          <h2 className="text-lg font-semibold mb-3">{t("now.why")}</h2>
          {data.why ? <WhyChain why={data.why} /> : <Status empty />}
        </section>
        <section className="lg:border-l lg:border-rule lg:pl-10">
          <h2 className="text-lg font-semibold mb-3">{t("now.todo")}</h2>
          <Tips tips={data.tips} />
        </section>
        <section className="lg:border-l lg:border-rule lg:pl-10">
          <h2 className="text-lg font-semibold mb-3">{t("now.weather")}</h2>
          <Alerts alerts={data.alerts} />
        </section>
      </div>

      <section className="mt-14 pt-6 border-t border-rule">
        <h2 className="text-sm font-semibold mb-3">{t("now.dates")}</h2>
        <DataDates dates={data.data_dates} />
      </section>
    </div>
  );
}
