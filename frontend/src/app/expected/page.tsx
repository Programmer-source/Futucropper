"use client";
import { useEffect, useMemo, useState } from "react";
import { PageHead, Status } from "@/components/bits";
import { Legend, TimeChart } from "@/components/TimeChart";
import { EventRow, useApi } from "@/lib/api";
import { COUNTRY_COLOR } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useZone, useZoneName } from "@/lib/zone";

type Pt = { date: string; actual: number; expected: number; expected_low: number; expected_high: number; gap: number; gap_pct: number };

export default function Expected() {
  const { t, list } = useT();
  const { meta, zoneId, zone } = useZone();
  const name = useZoneName();
  const [shown, setShown] = useState(zoneId);
  useEffect(() => setShown(zoneId), [zoneId]);
  const country = (zone?.country ?? "UA") as "UA" | "AU";
  const peers = meta?.zones.filter((z) => z.country === country) ?? [];
  const shownZone = peers.find((z) => z.zone === shown) ?? zone;
  const { data, error, loading } = useApi<{ available: boolean; points: Pt[] }>(`/api/zones/${shown}/expected`);
  const events = useApi<EventRow[]>(`/api/events?country=${country}`);
  const pts = data?.points ?? [];

  // default month: the largest shortfall in 2022 onwards, the years the weather-only model never saw
  const worst = useMemo(() => {
    const recent = pts.filter((p) => p.date >= "2022-01-01" && p.gap_pct != null);
    const pool = recent.length ? recent : pts;
    return pool.length ? pool.reduce((a, b) => (b.gap_pct < a.gap_pct ? b : a)).date : "";
  }, [pts]);
  const [month, setMonth] = useState("");
  useEffect(() => setMonth(shownZone?.zone_type === "control" ? pts[pts.length - 1]?.date ?? "" : worst), [worst, pts, shownZone?.zone_type]);
  const sel = pts.find((p) => p.date === month);

  const chartData = pts.map((p) => ({
    date: p.date, actual: p.actual, expected: p.expected, expected_low: p.expected_low, expected_high: p.expected_high,
    base: Math.min(p.actual, p.expected), below: Math.max(p.expected - p.actual, 0),
  }));

  return (
    <div>
      <PageHead title={t("expected.title")} lead={t("expected.lead")} />
      <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label={t("expected.zone_switch")}>
        {peers.map((z) => (
          <button key={z.zone} onClick={() => setShown(z.zone)} aria-pressed={z.zone === shown}
            className={`text-sm px-3 py-1.5 rounded-full border ${z.zone === shown ? "bg-basalt text-white border-basalt" : "border-rule hover:border-basalt"}`}>
            {name(z.zone)} ({t(`zonetype.${z.zone_type}`)})
          </button>
        ))}
      </div>

      <Status loading={loading} error={error} empty={data ? !data.available || !pts.length : false} />
      {sel && (
        <p className="font-display text-xl sm:text-2xl measure">
          {t("expected.sentence", {
            month: list("months_in")[new Date(sel.date + "T00:00:00").getMonth()], year: sel.date.slice(0, 4), zone: name(shown),
            pct: Math.abs(Math.round(sel.gap_pct)), dir: sel.gap_pct < 0 ? t("expected.less") : t("expected.more"),
          })}
        </p>
      )}
      {shownZone?.zone_type === "control" && <p className="mt-4 measure border-l-4 border-canopy pl-4">{t("expected.control_note")}</p>}

      {pts.length > 0 && (
        <div className="mt-8 rounded-lg bg-panel border border-rule p-3">
          <TimeChart
            data={chartData}
            band={{ low: "expected_low", high: "expected_high", label: t("now.band") }}
            lines={[
              { key: "expected", label: t("expected.expected"), color: "#56655d", dash: "5 4", width: 1.6 },
              { key: "actual", label: t("expected.actual"), color: COUNTRY_COLOR[country], width: 2 },
            ]}
            gapFill={{ base: "base", gap: "below", color: "#b23a1d", label: t("expected.worse") }}
            yLabel={t("var.ndvi")}
            events={events.data ?? []}
            height={380}
          />
          <Legend items={[
            { label: t("expected.actual"), color: COUNTRY_COLOR[country] },
            { label: t("expected.expected"), color: "#56655d", dash: true },
            { label: t("now.band"), color: "#56655d", area: true },
            { label: t("expected.worse"), color: "#b23a1d", area: true },
          ]} />
        </div>
      )}

      {pts.length > 0 && (
        <label className="mt-6 block text-sm">
          <span className="text-moss">{t("expected.pick_month")}: </span>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-full border border-rule bg-panel px-3 py-1.5">
            {[...pts].reverse().map((p) => <option key={p.date} value={p.date}>{p.date.slice(0, 7)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
