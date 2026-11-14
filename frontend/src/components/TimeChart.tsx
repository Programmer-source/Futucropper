"use client";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EventRow } from "@/lib/api";
import { num } from "@/lib/format";
import { useT } from "@/lib/i18n";

type Series = { key: string; label: string; color: string; dash?: string; width?: number };

/** One chart style for every time series in the app. Events are dashed lines/areas with short labels. */
export function TimeChart({ data, lines, band, yLabel, events = [], height = 340, gapFill }: {
  data: Record<string, number | string | null>[];
  lines: Series[];
  band?: { low: string; high: string; label: string };
  /** shades the space between two lines: base = lower line, gap = distance up to the upper line */
  gapFill?: { base: string; gap: string; color: string; label: string };
  yLabel: string;
  events?: EventRow[];
  height?: number;
}) {
  const { lang } = useT();
  const first = data[0]?.date as string | undefined, last = data[data.length - 1]?.date as string | undefined;
  const ev = events.filter((e) => first && last && e.start >= first && e.start <= last);
  const nearEnd = (d: string) => !!first && !!last &&
    (new Date(d).getTime() - new Date(first).getTime()) / (new Date(last).getTime() - new Date(first).getTime()) > 0.82;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 46, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#e3e7e1" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={40} tick={{ fontSize: 12, fill: "#56655d" }} />
          <YAxis tick={{ fontSize: 12, fill: "#56655d" }} width={52}
            label={{ value: yLabel, angle: -90, position: "insideLeft", style: { fontSize: 12, fill: "#56655d" }, offset: 8, dy: 60 }} />
          <Tooltip
            formatter={(v) => (typeof v === "number" ? num(v, 2, false, lang) : String(v))}
            labelFormatter={(d) => String(d).slice(0, 7)}
            contentStyle={{ borderRadius: 8, border: "1px solid #d6dbd3", fontSize: 13 }}
          />
          {ev.map((e, i) =>
            e.end ? (
              <ReferenceArea key={i} x1={e.start.slice(0, 7) + "-01"} x2={(e.end ?? e.start).slice(0, 7) + "-01"} fill="#56655d" fillOpacity={0.07}
                label={{ value: lang === "uk" ? e.label_uk : e.label_en, position: "insideTopLeft", fontSize: 11, fill: "#56655d" }} />
            ) : (
              <ReferenceLine key={i} x={e.start.slice(0, 7) + "-01"} stroke="#56655d" strokeDasharray="4 4"
                label={{ value: lang === "uk" ? e.label_uk : e.label_en, position: nearEnd(e.start) ? "insideTopRight" : "top",
                  offset: nearEnd(e.start) ? 4 : 6 + (i % 2) * 16, fontSize: 11, fill: "#18231f" }} />
            ),
          )}
          {band && <Area dataKey={(d) => [d[band.low], d[band.high]]} name={band.label} stroke="none" fill="#56655d" fillOpacity={0.14} isAnimationActive={false} />}
          {gapFill && <Area dataKey={gapFill.base} stackId="gap" stroke="none" fill="none" isAnimationActive={false} legendType="none" tooltipType="none" />}
          {gapFill && <Area dataKey={gapFill.gap} stackId="gap" name={gapFill.label} stroke="none" fill={gapFill.color} fillOpacity={0.5} isAnimationActive={false} />}
          {lines.map((l) => (
            <Line key={l.key} dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={l.width ?? 1.8} strokeDasharray={l.dash}
              dot={false} isAnimationActive={false} connectNulls />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dash?: boolean; area?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-moss mt-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          {i.area ? (
            <span className="w-4 h-3 rounded-sm inline-block" style={{ background: i.color, opacity: 0.5 }} />
          ) : (
            <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke={i.color} strokeWidth="2.5" strokeDasharray={i.dash ? "5 3" : undefined} /></svg>
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}
