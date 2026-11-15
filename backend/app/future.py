"""See the Future: one read-only bundle per region for the /future tab, stepped by SEASON.
Only READS what is already computed:
  results/season_maps.json        observed field greenness per 0.05 deg cell, per season (pipeline/build_season_maps.py)
  data/processed/all_series.parquet  observed zone values over the same 3 months
  results/forecast.parquet        model forecasts, leads 1 and 3 only (lead 6 has no skill), placed in the target's season
  planner.cell_scenario / co2     2026-2035 soil-water scenario per season and CO2, called as is
Missing values stay None, never 0. explain() asks the existing llm.chat for a 2-sentence summary of one frame."""
import json
import math
from functools import lru_cache

from . import llm, logic, planner, store

FIRST_YEAR, LAST_YEAR = 2003, 2025
SCENARIO_YEARS = list(range(2026, 2036))
LEADS = (1, 3)  # lead 6 has no skill and is hidden
SEASONS = {"DJF": [12, 1, 2], "MAM": [3, 4, 5], "JJA": [6, 7, 8], "SON": [9, 10, 11]}
ORDER = list(SEASONS)


def _clean(v, digits):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else round(f, digits)


def _season_of(year, month):
    """(season year, season) of a calendar month; December counts toward the next year's DJF."""
    s = next(k for k, ms in SEASONS.items() if month in ms)
    return (year + 1 if month == 12 else year), s


def _months(year, season):
    """The 3 (year, month) pairs of a season; DJF 2024 = Dec 2023, Jan 2024, Feb 2024."""
    return [((year - 1) if m == 12 else year, m) for m in SEASONS[season]]


@lru_cache(maxsize=2)
def _season_file(mtime: float):
    return json.loads((store.ROOT / "results" / "season_maps.json").read_text(encoding="utf-8"))


def _season_maps():
    p = store.ROOT / "results" / "season_maps.json"
    return _season_file(p.stat().st_mtime) if p.exists() else None


def _observed(series, zone):
    """{(year, season): {ndvi_z, soil_mm, rain_mm, temp_c}} over the season's 3 months; any missing month -> None.
    Greenness, soil water, temperature = mean of the 3 months; rain = sum of the 3 months (mm/day x days)."""
    z = series[series["zone"] == zone]
    by_var = {}
    for var in ("ndvi_z", "soil_moisture", "precip", "temp"):
        s = z[z["variable"] == var].dropna(subset=["value"])
        by_var[var] = {(d.year, d.month): (float(v), d.days_in_month) for d, v in zip(s["date"], s["value"])}
    out = {}
    for y in range(FIRST_YEAR, LAST_YEAR + 1):
        for s in ORDER:
            ms = _months(y, s)
            row = {}
            for var, key, digits, how in (("ndvi_z", "ndvi_z", 3, "mean"), ("soil_moisture", "soil_mm", 1, "mean"),
                                          ("precip", "rain_mm", 0, "sum"), ("temp", "temp_c", 1, "mean")):
                vals = [by_var[var].get(m) for m in ms]
                if any(v is None for v in vals):
                    row[key] = None
                elif how == "sum":
                    row[key] = _clean(sum(v * days for v, days in vals), digits)
                else:
                    row[key] = _clean(sum(v for v, _ in vals) / 3, digits)
            out[(y, s)] = row
    return out


def _forecast(zone):
    f = store.load("forecast")
    if f is None:
        return {}
    f = f[(f["zone"] == zone) & (f["lead_months"].isin(LEADS))].sort_values("lead_months")
    out = {}
    for r in store.records(f):
        t = str(r["target_date"])[:10]
        key = _season_of(int(t[:4]), int(t[5:7]))
        out.setdefault(key, []).append({
            "lead_months": int(r["lead_months"]), "issue_date": str(r["issue_date"])[:10], "target_date": t,
            "predicted": _clean(r["predicted"], 2), "low": _clean(r["low"], 2), "high": _clean(r["high"], 2),
            "light": r.get("light_model") or logic.light(r["predicted"])})
    return out


def _mean(vals):
    vals = [v for v in vals if v is not None and not (isinstance(v, float) and math.isnan(v))]
    return round(sum(vals) / len(vals), 1) if vals else None


def _zone_cells(cells, z):
    """Indexes of the 25 km cells inside the zone box; the nearest one if none is inside."""
    idx = [i for i, c in enumerate(cells) if z["south"] <= c["lat"] <= z["north"] and z["west"] <= c["lon"] <= z["east"]]
    if not idx and cells:
        idx = [min(range(len(cells)), key=lambda i: (cells[i]["lat"] - z["lat"]) ** 2 + (cells[i]["lon"] - z["lon"]) ** 2)]
    return idx


@lru_cache(maxsize=4)
def _bundle(region: str, mtime: float):
    maps = _season_maps()
    reg = maps["regions"].get(region) if maps else None
    if reg is None:
        return None
    series = store.load("series")
    zones = [z for z in store.records(store.load("zones")) if z["country"] == region]

    # scenario per season: planner.cell_scenario called as is with that season's 3 months
    sc_cells, sc_change, sc_source, sc_res = None, {}, None, None
    for s in ORDER:
        cs = planner.cell_scenario(region, SEASONS[s], SCENARIO_YEARS)
        if cs is None:
            continue
        if sc_cells is None:
            sc_cells = [{"lat": c["lat"], "lon": c["lon"]} for c in cs["cells"]]
            sc_source, sc_res = cs["source"], cs["resolution"]
        by_pos = {(c["lat"], c["lon"]): c["change_mm"] for c in cs["cells"]}
        sc_change[s] = [by_pos.get((c["lat"], c["lon"]), [None] * len(SCENARIO_YEARS)) for c in sc_cells]
    co = planner.co2()
    co2 = [None if co is None else round(co["ppm"] + co["growth_ppm_per_year"] * (y - co["year"]), 1) for y in SCENARIO_YEARS]

    obs = {z["zone"]: _observed(series, z["zone"]) if series is not None else {} for z in zones}
    fc = {z["zone"]: _forecast(z["zone"]) for z in zones}
    zcells = {z["zone"]: _zone_cells(sc_cells or [], z) for z in zones}

    frames = []
    for y in range(FIRST_YEAR, LAST_YEAR + 1):
        for s in ORDER:
            frames.append({"id": f"{y}-{s}", "year": y, "season": s, "kind": "obs", "gi": y - FIRST_YEAR,
                           "zones": {zid: obs[zid].get((y, s)) for zid in obs}})
    for si, y in enumerate(SCENARIO_YEARS):
        for s in ORDER:
            zs = {}
            for z in zones:
                ch = sc_change.get(s)
                zs[z["zone"]] = {"scenario_mm": _mean([ch[i][si] for i in zcells[z["zone"]]]) if ch else None,
                                 "forecast": fc[z["zone"]].get((y, s), [])}
            kind = "fc" if any(v["forecast"] for v in zs.values()) else "sc"
            frames.append({"id": f"{y}-{s}", "year": y, "season": s, "kind": kind, "si": si,
                           "co2_ppm": co2[si], "zones": zs})

    return {
        "region": region,
        "grid": {k: reg[k] for k in ("west", "east", "north", "south", "nrows", "ncols")},
        "resolution": maps["resolution"], "source": maps["source"], "baseline": maps["baseline"],
        "seasons": SEASONS,
        "observed": {"years": reg["years"], "z": reg["z"]},
        "zones": [{k: z[k] for k in ("zone", "zone_type", "name_en", "name_uk", "lat", "lon", "west", "east", "south", "north")}
                  for z in zones],
        "scenario": None if sc_cells is None else {
            "years": SCENARIO_YEARS, "baseline": "2003-2021", "resolution": sc_res, "source": sc_source,
            "cells": sc_cells, "change_mm": sc_change, "co2_ppm": co2,
        },
        "frames": frames,
    }


def bundle(region: str):
    p = store.ROOT / "results" / "season_maps.json"
    return _bundle(region, p.stat().st_mtime) if p.exists() else None


# ---------- AI "What changed" (calls llm.chat as is) ----------

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SYSTEM = ("Explain what changed on the land in 2 short sentences for a farmer. Use only these numbers, with units. "
          "Name the biggest change and the likely reason from the data (e.g. less rain, lost irrigation). "
          "If kind is scenario, say 'if the trend continues'. Answer in {language}. No markdown.")
KIND_WORD = {"obs": "observed", "fc": "forecast", "sc": "scenario"}
_EXPLAIN = {}


def _f(v, digits, sign=False):
    if v is None:
        return "n/a"
    s = f"{v:+.{digits}f}" if sign else f"{v:.{digits}f}"
    return s


def _delta(a, b, digits):
    return None if a is None or b is None else round(a - b, digits)


def _events(region, year, season):
    out = []
    if region == "UA" and (year > 2023 or (year == 2023 and season in ("JJA", "SON"))):
        out.append("June 2023: Kakhovka dam destroyed")
    if region == "AU" and year in (2018, 2019, 2020):
        out.append("2018-19 Australian drought")
    return out


def explain_messages(b, year, season, lang):
    by_id = {f["id"]: f for f in b["frames"]}
    fr, pv = by_id.get(f"{year}-{season}"), by_id.get(f"{year - 1}-{season}")
    if fr is None:
        return None
    ms = SEASONS[season]
    head = (f"{b['region']} {year} {MONTHS_EN[ms[0] - 1]}-{MONTHS_EN[ms[-1] - 1]}, kind {KIND_WORD[fr['kind']]}; "
            f"(x) = {year - 1} same season ({KIND_WORD[pv['kind']] if pv else 'n/a'}), then change.")
    lines = [head]
    for z in b["zones"]:
        name = z["name_en"].split(",")[0]
        a = fr["zones"].get(z["zone"]) or {}
        p = (pv["zones"].get(z["zone"]) or {}) if pv else {}
        if fr["kind"] == "obs":
            g, gp = _clean(a.get("ndvi_z"), 1), _clean(p.get("ndvi_z"), 1)
            sm, smp = _clean(a.get("soil_mm"), 0), _clean(p.get("soil_mm"), 0)
            r, rp = a.get("rain_mm"), p.get("rain_mm")
            t, tp = a.get("temp_c"), p.get("temp_c")
            lines.append(f"{name}: greenness z {_f(g, 1)} ({_f(gp, 1)}, {_f(_delta(g, gp, 1), 1, True)}); soil {_f(sm, 0)} mm "
                         f"({_f(smp, 0)}, {_f(_delta(sm, smp, 0), 0, True)}); rain {_f(r, 0)} mm ({_f(rp, 0)}, {_f(_delta(r, rp, 0), 0, True)}); "
                         f"temp {_f(t, 1)} °C ({_f(tp, 1)}, {_f(_delta(t, tp, 1), 1, True)})")
        else:
            sc = a.get("scenario_mm")
            prev = p.get("scenario_mm") if pv and pv["kind"] != "obs" else None
            parts = [f"soil water vs 2003-21 {_f(sc, 1, True)} mm" + (f" (before {_f(prev, 1, True)})" if prev is not None else "")]
            for fc in a.get("forecast") or []:
                parts.append(f"forecast greenness z {_f(_clean(fc['predicted'], 1), 1)} for {fc['target_date'][:7]}")
            lines.append(f"{name}: " + "; ".join(parts))
    if fr["kind"] != "obs" and fr.get("co2_ppm") is not None:
        lines.append(f"CO2 {fr['co2_ppm']:.0f} ppm")
    ev = _events(b["region"], year, season)
    if ev:
        lines.append("Events: " + "; ".join(ev))
    language = planner.LANG_NAME.get(lang, "English")
    return [{"role": "system", "content": SYSTEM.format(language=language)}, {"role": "user", "content": "\n".join(lines)}]


def explain(region, year, season, lang):
    key = (region, year, season, lang)
    if key in _EXPLAIN:
        return _EXPLAIN[key]
    b = bundle(region)
    msgs = explain_messages(b, year, season, lang) if b else None
    if msgs is None:
        return {"text": None}
    r = llm.chat(msgs)
    if not r.get("text"):
        return {"text": None}
    out = {"text": r["text"], "provider": r["provider"]}
    _EXPLAIN[key] = out
    return out
