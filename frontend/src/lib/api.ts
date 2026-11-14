"use client";
import { useEffect, useState } from "react";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type Light = "green" | "yellow" | "red" | null;
export type Zone = {
  zone: string; country: "UA" | "AU"; zone_type: "irrigated" | "control";
  name_uk: string; name_en: string; lat: number; lon: number; west: number; south: number; east: number; north: number;
};
export type Meta = {
  mock: boolean; zones: Zone[]; variables: string[]; years: [number, number] | null; llm: boolean;
  data_dates: { variable: string; product: string; last_date: string; cadence: string }[];
  thresholds: { z_yellow: number; z_red: number };
};
export type ForecastRow = {
  lead_months: number; target_date: string; predicted: number; low: number; high: number;
  beats_baseline: boolean; light: Light;
};
export type Now = {
  zone: Zone | null;
  condition: { date: string; month: number; ndvi_z: number; pct_vs_normal: number } | null;
  light_now: Light;
  history: { date: string; value: number; light: Light }[];
  forecast: ForecastRow[];
  skill: { horizon: number; class_accuracy: number; rmse: number }[];
  alerts: { type: string; value: number; unit: string; percentile: number; active: boolean; period_start: string; period_end: string }[];
  why: { chain: { variable: string; z: number | null; state: string; is_bad: boolean }[]; driver: string | null; oni: number | null; enso: string | null; country: string } | null;
  tips: { tip: string; signal: string }[];
  data_dates: Meta["data_dates"];
};
export type TrendRow = {
  zone: string; variable: string; slope_per_decade: number; ci_low: number; ci_high: number;
  p_value: number; p_value_fdr: number; significant: boolean; badge: "confirmed" | "possible" | "none";
  years_to_significance: number | null; unit: string;
};
export type EventRow = { country: string; start: string; end: string | null; type: string; label_uk: string; label_en: string };

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/** Tiny fetch hook: { data, error, loading } — refetches when path changes */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null, error: null, loading: !!path,
  });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    get<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e) => alive && setState({ data: null, error: String(e.message || e), loading: false }));
    return () => {
      alive = false;
    };
  }, [path]);
  return state;
}
