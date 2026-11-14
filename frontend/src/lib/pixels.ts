"use client";
import { zColor } from "./format";

export type PixWindow = {
  id: string; months: number[]; label_en: string; label_uk: string;
  condition: (number | null)[][]; region_mean: (number | null)[];
  best_land: (number | null)[]; change: (number | null)[]; mean_ndvi: (number | null)[];
};
export type PixRegion = {
  west: number; east: number; north: number; south: number; nrows: number; ncols: number; years: number[];
  windows: PixWindow[]; event: { years: number[]; label_en: string; label_uk: string };
  now: { month: string; z: (number | null)[] };
};
export type PixelMaps = { source: string; resolution: number; baseline: number[]; last_month: string; regions: Record<string, PixRegion> };

/** Sequential scale for 0-100 scores: pale sand -> deep green */
export function scoreColor(v: number | null) {
  if (v === null || Number.isNaN(v)) return null;
  const f = Math.max(0, Math.min(1, v / 100));
  const a = [236, 226, 196], b = [36, 98, 68];
  const c = a.map((x, k) => Math.round(x + (b[k] - x) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function zFill(v: number | null) {
  return v === null || Number.isNaN(v) ? null : zColor(v);
}

/** Paint one grid (row-major, north row first) into a PNG data URL; one canvas pixel = one 0.05° cell. */
export function gridToDataUrl(values: (number | null)[], nrows: number, ncols: number, color: (v: number | null) => string | null) {
  const c = document.createElement("canvas");
  c.width = ncols;
  c.height = nrows;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(ncols, nrows);
  const tmp = document.createElement("canvas").getContext("2d");
  for (let i = 0; i < values.length; i++) {
    const col = color(values[i]);
    if (!col || !tmp) continue;
    tmp.fillStyle = col;
    const hex = tmp.fillStyle as string; // normalised to #rrggbb
    img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i * 4 + 3] = 235;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export function cellAt(r: PixRegion, res: number, lat: number, lon: number) {
  if (lon < r.west || lon > r.east || lat < r.south || lat > r.north) return null;
  const row = Math.min(r.nrows - 1, Math.floor((r.north - lat) / res));
  const col = Math.min(r.ncols - 1, Math.floor((lon - r.west) / res));
  return { row, col, i: row * r.ncols + col };
}

export function regionFor(maps: PixelMaps, lat: number, lon: number) {
  for (const [k, r] of Object.entries(maps.regions)) {
    if (lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north) return k;
  }
  return null;
}
