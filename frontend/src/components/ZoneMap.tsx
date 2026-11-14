"use client";
import { useEffect } from "react";
import { MapContainer, Rectangle, TileLayer, Tooltip, useMap } from "react-leaflet";
import { Zone } from "@/lib/api";

function Fit({ zones }: { zones: Zone[] }) {
  const map = useMap();
  useEffect(() => {
    if (!zones.length) return;
    const s = Math.min(...zones.map((z) => z.south)), n = Math.max(...zones.map((z) => z.north));
    const w = Math.min(...zones.map((z) => z.west)), e = Math.max(...zones.map((z) => z.east));
    map.fitBounds([[s, w], [n, e]], { padding: [24, 24] });
  }, [zones, map]);
  return null;
}

/** Zone boxes for the selected country. Click a box to choose it. */
export default function ZoneMap({ zones, selected, onSelect, names }: {
  zones: Zone[]; selected: string; onSelect: (z: string) => void; names: (z: string) => string;
}) {
  return (
    <MapContainer center={[47, 33]} zoom={6} scrollWheelZoom={false} className="h-72 md:h-full min-h-72 w-full rounded-lg border border-rule">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit zones={zones} />
      {zones.map((z) => {
        const irrigated = z.zone_type === "irrigated";
        const active = z.zone === selected;
        const color = irrigated ? "#2457a6" : "#6f7a73";
        return (
          <Rectangle
            key={z.zone}
            bounds={[[z.south, z.west], [z.north, z.east]]}
            pathOptions={{ color, weight: active ? 3.5 : 1.5, fillOpacity: active ? 0.28 : 0.1, dashArray: irrigated ? undefined : "6 5" }}
            eventHandlers={{ click: () => onSelect(z.zone) }}
          >
            <Tooltip direction="top" sticky>{names(z.zone)}</Tooltip>
          </Rectangle>
        );
      })}
    </MapContainer>
  );
}
