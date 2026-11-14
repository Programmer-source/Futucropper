"use client";
import { Now } from "@/lib/api";
import { LIGHT_COLOR, num, zColor } from "@/lib/format";
import { useT } from "@/lib/i18n";

const W = 760, H = 280, L = 44, R = 16, T = 18, B = 44;

function monthIndex(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.getFullYear() * 12 + d.getMonth();
}

/** Signature view: last 12 months of field greenness as soil-to-leaf coloured bars, then the forecast
 *  for 1, 3 (and 6) months with its 80% range. Thresholds are the app-wide drought lines. */
export function FieldStrip({ now, thresholds }: { now: Now; thresholds: { z_yellow: number; z_red: number } }) {
  const { t, list, lang } = useT();
  const months = list("months_short");
  const hist = now.history;
  const fc = now.forecast.filter((f) => f.lead_months <= 3 || f.beats_baseline);
  if (!hist.length) return null;

  const vals = [...hist.map((h) => h.value), ...fc.map((f) => f.low), thresholds.z_red - 0.5];
  const ZMIN = Math.max(-5, Math.floor(Math.min(...vals) - 0.3));
  const ZMAX = Math.min(5, Math.max(1.5, Math.ceil(Math.max(...hist.map((h) => h.value), ...fc.map((f) => f.high)) + 0.3)));
  const i0 = monthIndex(hist[0].date);
  const last = Math.max(monthIndex(hist[hist.length - 1].date), ...fc.map((f) => monthIndex(f.target_date)));
  const n = last - i0 + 1;
  const step = (W - L - R) / n;
  const x = (iso: string) => L + (monthIndex(iso) - i0) * step + step / 2;
  const y = (z: number) => T + ((ZMAX - Math.max(ZMIN, Math.min(ZMAX, z))) / (ZMAX - ZMIN)) * (H - T - B);
  const splitX = x(hist[hist.length - 1].date) + step / 2;
  const bw = Math.min(30, step * 0.72);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t("now.strip_title")}>
        <rect x={splitX} y={T - 6} width={W - R - splitX} height={H - T - B + 6} fill="#eef1ec" />
        <text x={L} y={12} fontSize="12" fill="var(--color-moss)">{t("now.observed")}</text>
        <text x={splitX + 8} y={12} fontSize="12" fill="var(--color-moss)">{t("now.forecast")}</text>

        {[
          { z: thresholds.z_yellow, label: t("now.risk_line"), c: "var(--color-straw)" },
          { z: thresholds.z_red, label: t("now.drought_line"), c: "var(--color-scorch)" },
        ].map((l) => (
          <g key={l.label}>
            <line x1={L} x2={W - R} y1={y(l.z)} y2={y(l.z)} stroke={l.c} strokeDasharray="5 4" strokeWidth="1.2" />
            <text x={L - 6} y={y(l.z) + 4} fontSize="11" textAnchor="end" fill={l.c}>{l.label}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--color-basalt)" strokeWidth="1" />
        <text x={L - 6} y={y(0) + 4} fontSize="11" textAnchor="end" fill="var(--color-moss)">0</text>

        {hist.map((h, i) => {
          const top = Math.min(y(0), y(h.value));
          const height = Math.max(2, Math.abs(y(h.value) - y(0)));
          return (
            <g key={h.date}>
              <rect
                className="strip-bar"
                style={{ transformOrigin: `center ${y(0)}px`, animationDelay: `${i * 35}ms` }}
                x={x(h.date) - bw / 2} y={top} width={bw} height={height} rx="3"
                fill={zColor(h.value)} stroke="rgba(24,35,31,.25)" strokeWidth="0.5"
              >
                <title>{`${months[new Date(h.date).getMonth()]}: z ${num(h.value, 2, true, lang)}`}</title>
              </rect>
              <text x={x(h.date)} y={H - B + 18} fontSize="11" textAnchor="middle" fill="var(--color-moss)">
                {months[new Date(h.date + "T00:00:00").getMonth()]}
              </text>
            </g>
          );
        })}

        {fc.map((f) => {
          const cx = x(f.target_date);
          const c = f.light ? LIGHT_COLOR[f.light] : "#999";
          return (
            <g key={f.lead_months}>
              <line x1={cx} x2={cx} y1={y(f.high)} y2={y(f.low)} stroke={c} strokeWidth="10" strokeLinecap="round" opacity="0.22" />
              <path d={`M ${cx} ${y(f.predicted) - 8} L ${cx + 8} ${y(f.predicted)} L ${cx} ${y(f.predicted) + 8} L ${cx - 8} ${y(f.predicted)} Z`} fill={c} />
              <text x={cx} y={H - B + 18} fontSize="11" textAnchor="middle" fill="var(--color-basalt)">
                {months[new Date(f.target_date + "T00:00:00").getMonth()]}
              </text>
              <text x={cx} y={H - B + 32} fontSize="10.5" textAnchor="middle" fill="var(--color-moss)">
                {t("now.in_months", { n: f.lead_months })}
              </text>
              <title>{`${t("now.band")}: ${num(f.low, 1, true, lang)} … ${num(f.high, 1, true, lang)}`}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-sm text-moss measure mt-2">
        {t("now.strip_help")} <span className="whitespace-nowrap">◆ {t("now.forecast")}, ▮ {t("now.band")}.</span>
      </figcaption>
    </figure>
  );
}
