"use client";
import { useT } from "@/lib/i18n";
import { useZone, useZoneName } from "@/lib/zone";

/** Zone switch grouped by country; the map on the home page offers the same choice visually. */
export function ZonePicker() {
  const { t } = useT();
  const { meta, zoneId, setZoneId } = useZone();
  const name = useZoneName();
  if (!meta) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-moss">{t("zone.pick")}</span>
      <select
        value={zoneId}
        onChange={(e) => setZoneId(e.target.value)}
        className="rounded-full border border-rule bg-panel px-3 py-1.5 max-w-[16rem]"
      >
        {(["UA", "AU"] as const).map((c) => (
          <optgroup key={c} label={t(`country.${c}`)}>
            {meta.zones.filter((z) => z.country === c).map((z) => (
              <option key={z.zone} value={z.zone}>
                {name(z.zone)} ({t(`zonetype.${z.zone_type}`)})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
