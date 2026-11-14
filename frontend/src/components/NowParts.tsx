"use client";
import { Meta, Now } from "@/lib/api";
import { fmtDate, num } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** "Less rain → soil moisture low → crops stressed" built from the zone's actual anomalies */
export function WhyChain({ why }: { why: NonNullable<Now["why"]> }) {
  const { t, lang } = useT();
  const steps = why.chain.filter((c) => c.variable !== "vpd" || c.state === "high");
  return (
    <div>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[1.05rem]">
        {steps.map((c, i) => (
          <li key={c.variable} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="text-moss">→</span>}
            <span className={c.is_bad ? "font-semibold" : ""}>
              {c.state === "unknown" ? t("why.unknown") : t(`why.${c.variable}.${c.state}`)}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 space-y-1 text-sm text-moss measure">
        {why.enso && why.oni !== null && <p>{t(`why.enso.${why.enso}.${why.country}`, { oni: num(why.oni, 1, true, lang) })}</p>}
        {why.driver && <p>{t("why.driver", { driver: t(`var.${why.driver}`).toLowerCase() })}</p>}
      </div>
    </div>
  );
}

export function Tips({ tips }: { tips: Now["tips"] }) {
  const { t } = useT();
  return (
    <div>
      <ul className="space-y-2">
        {tips.map((x) => (
          <li key={x.tip} className="flex gap-3">
            <span aria-hidden className="mt-2 w-1.5 h-1.5 rounded-full bg-basalt shrink-0" />
            <span>{t(`tip.${x.tip}`)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-moss">{t("tip.reviewed")}</p>
    </div>
  );
}

const ALERT_ICON: Record<string, string> = { dry_spell_next8d: "📅", dry_spell: "☀️", heat30: "🌡️", heat35: "🔥", frost: "❄️", heavy_rain: "🌧️" };

export function Alerts({ alerts }: { alerts: Now["alerts"] }) {
  const { t, lang } = useT();
  const active = alerts.filter((a) => a.active);
  const quiet = alerts.filter((a) => !a.active);
  return (
    <div>
      {alerts[0] && (
        <p className="text-xs text-moss mb-2">
          {t("alert.period", { start: fmtDate(alerts[0].period_start, lang), end: fmtDate(alerts[0].period_end, lang) })}
        </p>
      )}
      {active.length === 0 && <p>{t("alert.none")}</p>}
      <ul className="space-y-2">
        {active.map((a) => (
          <li key={a.type} className="flex gap-2">
            <span aria-hidden>{ALERT_ICON[a.type] ?? "•"}</span>
            <span>{t(`alert.${a.type}`, { value: a.value, pct: a.percentile })}</span>
          </li>
        ))}
      </ul>
      {quiet.length > 0 && (
        <p className="mt-3 text-sm text-moss">
          {t("alert.also")}: {quiet.map((a) => `${ALERT_ICON[a.type] ?? ""} ${t(`alert.${a.type}`, { value: a.value, pct: a.percentile })}`).join(" ")}
        </p>
      )}
    </div>
  );
}

export function DataDates({ dates }: { dates: Meta["data_dates"] }) {
  const { t, lang } = useT();
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3 text-sm">
      {dates.map((d) => (
        <div key={d.variable}>
          <dt className="text-moss">{t(`var.${d.variable}`)}</dt>
          <dd className="tabular">{fmtDate(d.last_date, lang)}</dd>
        </div>
      ))}
    </dl>
  );
}
