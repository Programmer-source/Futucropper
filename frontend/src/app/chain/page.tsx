"use client";
import { PageHead, Status } from "@/components/bits";
import { useApi } from "@/lib/api";
import { COUNTRY_COLOR, num } from "@/lib/format";
import { useT } from "@/lib/i18n";

type Link = { country: string; from_var: string; to_var: string; lag_months: number; corr: number; p_value_fdr: number; significant: boolean };
type Summary = { country: string; metric: string; value: number | null };

const BW = 140, BH = 48;
const POS: Record<string, [number, number]> = {
  ghg: [12, 24], oni: [12, 134],
  temp: [252, 24], precip: [252, 134],
  vpd: [492, 24], soil_moisture: [492, 134], evap: [492, 244],
  ndvi: [732, 134],
};

function Diagram({ country, links }: { country: "UA" | "AU"; links: Link[] }) {
  const { t, lang } = useT();
  const color = COUNTRY_COLOR[country];
  const anchor = (v: string, side: "out" | "in", other: string) => {
    const [x, y] = POS[v], [ox, oy] = POS[other];
    if (ox === x) return side === "out" ? [x + BW / 2, oy > y ? y + BH : y] : [x + BW / 2, oy > y ? y + BH : y];
    return side === "out" ? [x + BW, y + BH / 2] : [x, y + BH / 2];
  };
  const vars = new Set(["ghg", ...links.flatMap((l) => [l.from_var, l.to_var])]);
  return (
    <svg viewBox="0 0 884 304" className="w-full h-auto" role="img" aria-label={`${t("chain.title")}: ${t(`country.${country}`)}`}>
      <defs>
        {["sig", "weak"].map((k) => (
          <marker key={k} id={`arrow-${country}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill={k === "sig" ? color : "#b7beb6"} />
          </marker>
        ))}
      </defs>
      {/* greenhouse gases: long-term context, no monthly link */}
      <line x1={12 + BW} y1={24 + BH / 2} x2={250} y2={24 + BH / 2} stroke="#b7beb6" strokeDasharray="3 4" strokeWidth="1.5" markerEnd={`url(#arrow-${country}-weak)`} />
      {links.filter((l) => POS[l.from_var] && POS[l.to_var]).map((l) => {
        const [x1, y1] = anchor(l.from_var, "out", l.to_var);
        const [x2, y2] = anchor(l.to_var, "in", l.from_var);
        const sig = l.significant;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const vertical = x1 === x2;
        return (
          <g key={l.from_var + l.to_var}>
            <line x1={x1} y1={y1} x2={x2 - (vertical ? 0 : 2)} y2={y2} stroke={sig ? color : "#b7beb6"} strokeWidth={sig ? 1.5 + Math.abs(l.corr) * 5 : 1.5}
              strokeDasharray={sig ? undefined : "5 4"} markerEnd={`url(#arrow-${country}-${sig ? "sig" : "weak"})`} opacity={sig ? 0.9 : 1} />
            {(() => {
              const diag = !vertical && y1 !== y2;
              const lx = vertical ? mx + 12 : diag ? mx + 14 : mx;
              const ly = vertical ? my - 4 : diag ? my - 10 : my - 22;
              const anchorTxt = vertical || diag ? "start" : "middle";
              const fill = sig ? "var(--color-basalt)" : "#8a948c";
              return sig ? (
                <text x={lx} y={ly} fontSize="12.5" textAnchor={anchorTxt} fill={fill} className="tabular">
                  <tspan x={lx} dy="0" fontWeight="600">{t("chain.months", { n: l.lag_months })}</tspan>
                  <tspan x={lx} dy="15">{t("chain.strength", { r: num(l.corr, 2, true, lang) })}</tspan>
                </text>
              ) : (
                <text x={lx} y={ly + 8} fontSize="12" textAnchor={anchorTxt} fill={fill}>{t("chain.not_sig")}</text>
              );
            })()}
          </g>
        );
      })}
      {[...vars].filter((v) => POS[v]).map((v) => {
        const [x, y] = POS[v];
        const end = v === "ndvi", ctx = v === "ghg";
        return (
          <g key={v}>
            <rect x={x} y={y} width={BW} height={BH} rx="8" fill={end ? "#e3efe6" : ctx ? "#f3f5f0" : "#fff"}
              stroke={ctx ? "#b7beb6" : "var(--color-basalt)"} strokeDasharray={ctx ? "4 3" : undefined} strokeWidth={end ? 2 : 1} />
            <foreignObject x={x + 6} y={y + 4} width={BW - 12} height={BH - 8}>
              <div className="h-full flex items-center justify-center text-center text-[12.5px] leading-tight" style={{ color: ctx ? "#56655d" : "#18231f" }}>
                {t(`var.${v}`)}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

export default function Chain() {
  const { t } = useT();
  const { data, error, loading } = useApi<{ available: boolean; links: Link[]; summary: Summary[] }>("/api/chain");
  if (!data) return <Status loading={loading} error={error} />;
  if (!data.available) return <Status empty />;
  const lag = (c: string) => data.summary.find((s) => s.country === c && s.metric === "chain_lag_months")?.value;

  return (
    <div>
      <PageHead title={t("chain.title")} lead={t("chain.lead")} />
      {lag("UA") != null && lag("AU") != null && (
        <p className="font-display text-xl sm:text-2xl measure mb-8">
          {t("chain.conclusion", { ua: t("chain.months", { n: lag("UA")! }), au: t("chain.months", { n: lag("AU")! }) })}
        </p>
      )}
      {(["UA", "AU"] as const).map((c) => (
        <section key={c} className="mt-8">
          <h2 className="text-lg font-semibold flex items-center gap-3">
            <span className="w-6 h-1 rounded" style={{ background: COUNTRY_COLOR[c] }} aria-hidden />
            {t(`country.${c}`)}
          </h2>
          <div className="mt-3 rounded-lg bg-panel border border-rule p-3 overflow-x-auto">
            <div className="min-w-[640px]"><Diagram country={c} links={data.links.filter((l) => l.country === c)} /></div>
          </div>
        </section>
      ))}
      <div className="mt-6 space-y-2 text-sm text-moss measure">
        <p>{t("chain.legend")}</p>
        <p>{t("chain.ghg_note")}</p>
      </div>
    </div>
  );
}
