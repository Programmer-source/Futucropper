"use client";
/** Leaflet maps (client only; pages import this file with next/dynamic and ssr:false). */
import { useEffect } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Polygon, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { Light, Zone } from "@/lib/api";
import { LIGHT_COLOR } from "@/lib/format";

type Bounds = [[number, number], [number, number]];

function Fit({ bounds }: { bounds: Bounds }) {
  const map = useMap();
  const key = bounds.flat().join(",");
  useEffect(() => { map.fitBounds(bounds, { padding: [10, 10] }); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Clicks({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

const Tiles = () => (
  <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
);

function Zones({ zones, lights, labels, onPick }: { zones: Zone[]; lights?: Record<string, Light>; labels?: Record<string, string>; onPick: (lat: number, lon: number) => void }) {
  return (
    <>
      {zones.map((z) => {
        const light = lights?.[z.zone] ?? null;
        const color = light ? LIGHT_COLOR[light] : "#18231f";
        return (
          <Rectangle key={z.zone} bounds={[[z.south, z.west], [z.north, z.east]]}
            pathOptions={{ color, weight: 3, fill: false, dashArray: z.zone_type === "irrigated" ? undefined : "7 5" }}
            eventHandlers={{ click: (e) => onPick(e.latlng.lat, e.latlng.lng) }}>
            {labels?.[z.zone] && <Tooltip permanent direction="top" offset={[0, -4]} className="zone-label">{labels[z.zone]}</Tooltip>}
          </Rectangle>
        );
      })}
    </>
  );
}

export function FarmMap({ bounds, image, zones, lights, labels, picked, onPick }: {
  bounds: Bounds; image: string | null; zones: Zone[]; lights?: Record<string, Light>; labels?: Record<string, string>;
  picked: { lat: number; lon: number } | null; onPick: (lat: number, lon: number) => void;
}) {
  return (
    <MapContainer bounds={bounds} zoomSnap={0.25} scrollWheelZoom className="h-[min(62vh,560px)] w-full rounded-lg border border-rule">
      <Tiles />
      <Fit bounds={bounds} />
      <Clicks onPick={onPick} />
      {image && <ImageOverlay url={image} bounds={bounds} opacity={0.82} className="pix-overlay" />}
      <Zones zones={zones} lights={lights} labels={labels} onPick={onPick} />
      {picked && <CircleMarker center={[picked.lat, picked.lon]} radius={8} pathOptions={{ color: "#18231f", weight: 3, fillColor: "#fff", fillOpacity: 1 }} />}
    </MapContainer>
  );
}

export type SimCell = { lat: number; lon: number; value: number | null; label: string };

/** Plan map: pick a point, see the field drawn to scale, and (optionally) the scenario cells for one year */
export function PlanMap({ bounds, zones, picked, onPick, fieldSideM, cells, cellRes, cellColor, height = "h-[340px]" }: {
  bounds: Bounds; zones: Zone[]; picked: { lat: number; lon: number } | null; onPick?: (lat: number, lon: number) => void;
  fieldSideM?: number | null; cells?: SimCell[]; cellRes?: number; cellColor?: (v: number | null) => string; height?: string;
}) {
  const half = (cellRes ?? 0.25) / 2;
  let field: [number, number][] | null = null;
  if (picked && fieldSideM && fieldSideM > 0) {
    const dLat = fieldSideM / 2 / 111320;
    const dLon = fieldSideM / 2 / (111320 * Math.cos((picked.lat * Math.PI) / 180));
    field = [[picked.lat - dLat, picked.lon - dLon], [picked.lat - dLat, picked.lon + dLon], [picked.lat + dLat, picked.lon + dLon], [picked.lat + dLat, picked.lon - dLon]];
  }
  return (
    <MapContainer bounds={bounds} zoomSnap={0.25} scrollWheelZoom className={`${height} w-full rounded-lg border border-rule`}>
      <Tiles />
      <Fit bounds={bounds} />
      {onPick && <Clicks onPick={onPick} />}
      {cells?.map((c) => (
        <Rectangle key={`${c.lat},${c.lon}`} bounds={[[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]]}
          pathOptions={{ stroke: false, fillColor: cellColor ? cellColor(c.value) : "#ccc", fillOpacity: 0.75 }}
          eventHandlers={onPick ? { click: (e) => onPick(e.latlng.lat, e.latlng.lng) } : undefined}>
          <Tooltip sticky>{c.label}</Tooltip>
        </Rectangle>
      ))}
      <Zones zones={zones} onPick={onPick ?? (() => {})} />
      {field && <Polygon positions={field} pathOptions={{ color: "#18231f", weight: 2, fillColor: "#f2c14e", fillOpacity: 0.7 }} />}
      {picked && <CircleMarker center={[picked.lat, picked.lon]} radius={6} pathOptions={{ color: "#18231f", weight: 2, fillColor: "#fff", fillOpacity: 1 }} />}
    </MapContainer>
  );
}
