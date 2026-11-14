"""Plan calculator and map-spot facts.

Every number here comes from one of three places, and the response says which:
  nasa   - the zone's NASA monthly history (MODIS, GPM IMERG, GLDAS, MERRA-2) via advisor.score_month,
           the team's forecast/alert models (logic.now, alerts.csv), GLDAS cells (scenario_cells.json)
  ipcc   - IPCC 2019 Refinement Tier 1 emission factors and AR6 GWP100 (constants below, cited in SOURCES)
  guide  - typical agronomy values (seed rates, row spacing, FAO-56 soil water, typical N and diesel) that the
           user can overwrite; the frontend labels them "typical"
The multi-year part is a scenario ("if the 2003-2025 trend continues"), never a forecast.
"""
import json
from datetime import date
from functools import lru_cache

import numpy as np
import pandas as pd

from . import advisor, logic, store

# national cereal yield is dominated by wheat and barley in both countries; not shown for maize/rice (very different yields)
CEREALS = {"winter_wheat", "spring_barley", "wheat_au", "barley_au"}

# guide: seed kg/ha (low, high), row spacing cm, sowing depth cm, FAO-56 Table 22 max root depth (m) and depletion p,
#        typical N kg/ha (editable default), typical season length in days
CROP_GUIDE = {
    "winter_wheat": {"seed": (180, 220), "row_cm": 15, "depth_cm": (3, 5), "root_m": (1.5, 1.8), "p": 0.55, "n": 100},
    "spring_barley": {"seed": (160, 200), "row_cm": 15, "depth_cm": (3, 4), "root_m": (1.0, 1.5), "p": 0.55, "n": 60},
    "maize": {"seed": (18, 25), "row_cm": 70, "depth_cm": (5, 7), "root_m": (1.0, 1.7), "p": 0.55, "n": 120},
    "sunflower": {"seed": (4, 6), "row_cm": 70, "depth_cm": (5, 7), "root_m": (0.8, 1.5), "p": 0.45, "n": 50},
    "soybean": {"seed": (90, 120), "row_cm": 45, "depth_cm": (3, 5), "root_m": (0.6, 1.3), "p": 0.50, "n": 20},
    "wheat_au": {"seed": (50, 80), "row_cm": 22.5, "depth_cm": (3, 5), "root_m": (1.0, 1.5), "p": 0.55, "n": 60},
    "canola": {"seed": (2.5, 4), "row_cm": 25, "depth_cm": (1, 2), "root_m": (1.0, 1.5), "p": 0.60, "n": 80},
    "barley_au": {"seed": (50, 80), "row_cm": 22.5, "depth_cm": (3, 5), "root_m": (1.0, 1.5), "p": 0.55, "n": 50},
    "rice": {"seed": (120, 150), "row_cm": 18, "depth_cm": (1, 2), "root_m": (0.5, 1.0), "p": 0.20, "n": 150},
    "cotton": {"seed": (10, 14), "row_cm": 100, "depth_cm": (3, 5), "root_m": (1.0, 1.7), "p": 0.65, "n": 200},
}
# FAO-56 Table 19: total available water (theta_FC - theta_WP), midpoint, mm of water per m of soil
SOIL_TAW = {"sand": 80, "loamy_sand": 90, "sandy_loam": 130, "loam": 155, "silt_loam": 160,
            "silty_clay_loam": 155, "clay": 160}
UNIT_TO_HA = {"ha": 1.0, "acre": 0.404686, "m2": 1e-4, "km2": 100.0, "sotka": 0.01}
IRRIGATION = {"none": False, "partial": 0.75, "full": 0.5}
# typical diesel for the whole season by tillage (editable); only used when the user leaves fuel empty
DIESEL_TYPICAL = {"plough": 70, "reduced": 50, "notill": 35}

# ipcc (2019 Refinement, Vol 4 Ch 11 Tables 11.1 & 11.3, Ch 5 Tables 5.11-5.12; dry climate, both regions)
EF1_DRY = 0.005           # kg N2O-N per kg N, synthetic N, dry climate
EF1_RICE = 0.004          # flooded rice
FRAC_GASF = 0.11          # share of synthetic N volatilised
EF4_DRY = 0.005           # N2O-N per kg volatilised N, dry climate
FRAC_LEACH = 0.24         # leached share, applied only with irrigation in dry climates
EF5 = 0.011
UREA_C = 0.20             # t C per t urea (Eq. 11.13)
RICE_EF = 1.19            # kg CH4/ha/day, continuously flooded, global default
RICE_DAYS = 113           # IPCC default cultivation period
RICE_SFW = {"flooded": 1.0, "single": 0.71, "multiple": 0.55}
GWP_N2O, GWP_CH4 = 273, 27.0   # AR6 GWP100 (CH4 non-fossil)
DIESEL_CO2 = 2.68         # kg CO2 per litre (IPCC 2006 Vol 2: 74.1 t CO2/TJ, NCV 43 TJ/Gg, 0.84 kg/L)

SOURCES = {
    "nasa": "NASA MODIS MOD13C2, GPM IMERG, GLDAS Noah 2.1, MERRA-2 (zone history 2003-2025)",
    "ipcc_n2o": "IPCC 2019 Refinement Vol 4 Ch 11, Tables 11.1 & 11.3 (dry climate)",
    "ipcc_rice": "IPCC 2019 Refinement Vol 4 Ch 5, Tables 5.11-5.12",
    "gwp": "IPCC AR6 WG1 Table 7.15, GWP100: N2O 273, CH4 27.0",
    "fao56": "FAO-56 Tables 19 & 22 (soil water, rooting depth)",
    "yield": "Team model: World Bank national cereal yield vs NASA weather, LOYO MAE 229 kg/ha",
    "co2": "NOAA GML Mauna Loa CO2",
}


def sen_slope(y, x):
    y, x = np.asarray(y, float), np.asarray(x, float)
    ok = ~np.isnan(y)
    y, x = y[ok], x[ok]
    if len(y) < 5:
        return None, None
    i, j = np.triu_indices(len(y), 1)
    slope = float(np.median((y[j] - y[i]) / (x[j] - x[i])))
    intercept = float(np.median(y - slope * x))
    return slope, intercept


def mk_p(y):
    """Plain Mann-Kendall two-sided p (normal approximation); the app reports it only as 'confirmed or not'."""
    from math import erf, sqrt
    y = np.asarray([v for v in y if v is not None and not np.isnan(v)])
    n = len(y)
    if n < 8:
        return None
    s = sum(np.sign(y[j] - y[i]) for i in range(n - 1) for j in range(i + 1, n))
    var = n * (n - 1) * (2 * n + 5) / 18
    z = (s - np.sign(s)) / sqrt(var) if s != 0 else 0
    return float(2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2)))))


def yearly(series, zone, var, months):
    s = series[(series["zone"] == zone) & (series["variable"] == var)].set_index("date")["value"]
    s = s[s.index.month.isin(months)]
    g = s.groupby(s.index.year).mean()
    return g[g.index <= 2025]


def projected_prob_below(values, years, target_year, threshold=-1.0):
    """Shift the past years along their Sen trend line to target_year and count how often they fall below threshold."""
    slope, icpt = sen_slope(values, years)
    if slope is None:
        return None, None
    v, x = np.asarray(values, float), np.asarray(years, float)
    resid = v - (icpt + slope * x)
    future = icpt + slope * target_year + resid
    return float((future < threshold).mean()), slope


@lru_cache(maxsize=2)
def _cells(mtime: float):
    return json.loads((store.ROOT / "results" / "scenario_cells.json").read_text())


def cells():
    p = store.ROOT / "results" / "scenario_cells.json"
    return _cells(p.stat().st_mtime) if p.exists() else None


@lru_cache(maxsize=2)
def _co2(mtime: float):
    d = pd.read_csv(store.ROOT / "pipeline/feature_csvs/11_greenhouse_gases_climate_indices_monthly.csv", parse_dates=["date"])
    a = d.groupby(d["date"].dt.year)["co2_mlo_ppm"].mean()
    a = a[a.index <= 2025]
    last10 = a.loc[2016:2025]
    growth = float(np.polyfit(last10.index, last10.values, 1)[0])
    return {"year": 2025, "ppm": round(float(a.loc[2025]), 2), "growth_ppm_per_year": round(growth, 2)}


def co2():
    p = store.ROOT / "pipeline/feature_csvs/11_greenhouse_gases_climate_indices_monthly.csv"
    return _co2(p.stat().st_mtime) if p.exists() else None


def cell_scenario(country, months, years_out, lat=None, lon=None):
    """Per GLDAS cell: soil moisture 0-40 cm in the crop's sensitive months; baseline 2003-2021; projection per year."""
    c = cells()
    if c is None:
        return None
    reg = c["regions"].get(country)
    if reg is None:
        return None
    yrs = c["years"]
    base_idx = [i for i, y in enumerate(yrs) if y <= 2021]
    out, nearest, best_d = [], None, 1e9
    for cell in reg["cells"]:
        vals = np.array([[np.nan if v is None else v for v in cell["sm"][m - 1]] for m in months]).mean(axis=0)
        slope, icpt = sen_slope(vals, yrs)
        if slope is None:
            continue
        base = float(np.nanmean(vals[base_idx]))
        sd = float(np.nanstd(vals[base_idx], ddof=1))
        resid = vals - (icpt + slope * np.array(yrs))
        proj, dry = [], []
        for y in years_out:
            line = icpt + slope * y
            proj.append(round(line - base, 1))
            dry.append(round(float(np.nanmean(line + resid < base - sd)), 2))
        row = {"lat": cell["lat"], "lon": cell["lon"], "base_mm": round(base, 1), "slope_mm_per_decade": round(slope * 10, 1),
               "change_mm": proj, "dry_chance": dry}
        out.append(row)
        if lat is not None:
            d = (cell["lat"] - lat) ** 2 + (cell["lon"] - lon) ** 2
            if d < best_d:
                best_d, nearest = d, row
    return {"cells": out, "nearest": nearest, "resolution": c["resolution"], "source": c["source"]}


def season_start_year(sow, today=None):
    t = today or date.today()
    return t.year if sow > t.month else t.year + 1


def ghg(crop, n, fert, tillage, fuel, irrigation, rice_water, area_ha):
    """On-farm emissions per hectare (IPCC Tier 1). Boundaries: field N2O, urea CO2, diesel, rice CH4; not
    fertiliser manufacture, lime, residues or soil carbon change."""
    rice = crop == "rice"
    n = max(0.0, float(n or 0))
    direct = n * (EF1_RICE if rice else EF1_DRY)
    vol = n * FRAC_GASF * EF4_DRY
    leach = n * FRAC_LEACH * EF5 if irrigation != "none" else 0.0
    n2o_kg = (direct + vol + leach) * 44 / 28
    urea_share = {"urea": 1.0, "uan": 0.5}.get(fert, 0.0)
    urea_co2 = n * urea_share / 0.46 * UREA_C * 44 / 12
    fuel_l = float(fuel) if fuel not in (None, "") else DIESEL_TYPICAL.get(tillage, 50)
    diesel = fuel_l * DIESEL_CO2
    ch4 = RICE_EF * RICE_SFW.get(rice_water, 1.0) * RICE_DAYS if rice else 0.0
    parts = {"n2o": n2o_kg * GWP_N2O, "urea": urea_co2, "diesel": diesel, "ch4": ch4 * GWP_CH4}
    per_ha = sum(parts.values())
    return {"per_ha_kg": round(per_ha, 1), "total_t": round(per_ha * area_ha / 1000, 2),
            "parts_kg_ha": {k: round(v, 1) for k, v in parts.items()},
            "n2o_kg_ha": round(n2o_kg, 2), "ch4_kg_ha": round(ch4, 1), "fuel_l_ha": fuel_l,
            "fuel_typical": fuel in (None, "")}


def ghg_tips(crop, n, fert, tillage, fuel, irrigation, rice_water, area_ha, base):
    """What-if recalculations with the same IPCC factors. Only options that change the number are returned."""
    tips = []

    def add(code, **kw):
        g = ghg(**{**dict(crop=crop, n=n, fert=fert, tillage=tillage, fuel=fuel, irrigation=irrigation,
                          rice_water=rice_water, area_ha=area_ha), **kw})
        save = base["per_ha_kg"] - g["per_ha_kg"]
        if save > 0.5:
            tips.append({"code": code, "save_kg_ha": round(save, 1), "save_t_total": round(save * area_ha / 1000, 2),
                         "pct": round(100 * save / base["per_ha_kg"], 1) if base["per_ha_kg"] else 0})
    if n and float(n) > 0:
        add("n_minus_20", n=float(n) * 0.8)
    if fert in ("urea", "uan"):
        add("no_urea", fert="other")
    if tillage != "notill":
        add("notill", tillage="notill", fuel=None if fuel in (None, "") else max(0.0, float(fuel) - (DIESEL_TYPICAL[tillage] - DIESEL_TYPICAL["notill"])))
    if crop == "rice" and rice_water != "multiple":
        add("rice_awd", rice_water="multiple")
    if irrigation != "none":
        add("no_leaching", irrigation="none")
    return sorted(tips, key=lambda t: -t["save_kg_ha"])


def plan(p: dict) -> dict:
    series = store.load("series")
    crop = p.get("crop")
    if series is None or crop not in advisor.CROPS:
        return {"available": False}
    c = advisor.CROPS[crop]
    lat, lon = p.get("lat"), p.get("lon")
    zone = p.get("zone") or (advisor.zone_for_point(lat, lon, c["country"]) if lat is not None else None)
    info = logic.zone_info(zone) if zone else None
    if info is None:
        return {"available": False}
    sow = int(p.get("sow") or c["sow"][0])
    irrigation = p.get("irrigation", "none")
    water = IRRIGATION.get(irrigation, False)
    soil = p.get("soil") or "unknown"
    unit = p.get("unit") or "ha"
    area = max(0.0, float(p.get("area") or 1))
    area_ha = area * UNIT_TO_HA.get(unit, 1.0)
    g = CROP_GUIDE[crop]

    chosen = advisor.score_month(series, zone, crop, sow, water)
    months = [advisor.score_month(series, zone, crop, m, water) for m in range(1, 13)]
    # the best month is searched only inside the crop's usual sowing window (a winter crop sown in spring never heads)
    best = max((m for m in months if m["in_window"]), key=lambda m: m["score"])

    warnings = []
    if c["country"] != info["country"]:
        warnings.append("crop_other_country")
    if not chosen["in_window"]:
        warnings.append("outside_window_winter" if c.get("winter") else "outside_window")
    if c["irrigated_only"] and irrigation == "none":
        warnings.append("needs_irrigation")
    if irrigation != "none" and info["zone_type"] != "irrigated":
        warnings.append("no_irrigation_system")
    if irrigation != "none" and zone == "UA_main":
        warnings.append("kakhovka_water_lost")
    if soil in ("sand", "loamy_sand") and irrigation == "none" and (chosen["risks"]["dry_key"] or 0) >= 0.15:
        warnings.append("sandy_dry")

    # soil water (FAO-56), only when the user named a texture
    soil_out = None
    if soil in SOIL_TAW:
        root = sum(g["root_m"]) / 2
        taw = SOIL_TAW[soil] * root
        soil_out = {"taw_mm_per_m": SOIL_TAW[soil], "root_m": round(root, 2), "store_mm": round(taw), "easy_mm": round(taw * g["p"])}

    # seed and layout
    lo, hi = g["seed"]
    dry_site = chosen["score"] < 50 and irrigation == "none"
    rate = lo if dry_site else round((lo + hi) / 2, 1)
    side_m = float(np.sqrt(area_ha * 10000))
    seed = {"rate_kg_ha": rate, "range_kg_ha": [lo, hi], "total_kg": round(rate * area_ha, 1), "row_cm": g["row_cm"],
            "depth_cm": list(g["depth_cm"]), "rows": int(side_m / (g["row_cm"] / 100)) if side_m else 0,
            "side_m": round(side_m), "dry_site_low_rate": dry_site}

    # harvest: national cereal model only
    harvest = None
    if crop in CEREALS:
        y = {"UA": (4982, 4587, 5287), "AU": (2370, 1976, 2675)}[info["country"]]
        harvest = {"kg_ha": y[0], "low": y[1], "high": y[2], "total_t": round(y[0] * area_ha / 1000, 1),
                   "total_low_t": round(y[1] * area_ha / 1000, 1), "total_high_t": round(y[2] * area_ha / 1000, 1), "year": 2025}

    n = p.get("n_kg_ha")
    n = g["n"] if n in (None, "") else float(n)
    fert, tillage, fuel = p.get("fert") or "other", p.get("tillage") or "reduced", p.get("fuel_l_ha")
    rice_water = p.get("rice_water") or "flooded"
    gh = ghg(crop, n, fert, tillage, fuel, irrigation, rice_water, area_ha)
    gh["n_kg_ha"], gh["n_typical"] = n, p.get("n_kg_ha") in (None, "")
    gh["tips"] = ghg_tips(crop, n, fert, tillage, fuel, irrigation, rice_water, area_ha, gh)
    if harvest:
        gh["per_t_grain_kg"] = round(gh["per_ha_kg"] / (harvest["kg_ha"] / 1000), 1)

    # horizon
    horizon = p.get("horizon") or "3m"
    now = logic.now(zone)
    out_h = {"kind": horizon}
    if horizon == "8d":
        a = store.load("alerts")
        r = a[(a.zone == zone) & (a.type == "dry_spell_next8d")] if a is not None else None
        if r is not None and not r.empty:
            r = r.iloc[-1]
            out_h.update({"dry_spell_chance_pct": int(r.value), "from": str(r.forecast_origin)[:10]})
    elif horizon in ("1m", "3m"):
        lead = 1 if horizon == "1m" else 3
        f = next((f for f in now["forecast"] if f["lead_months"] == lead), None)
        if f:
            out_h.update({"target": str(f["target_date"])[:7], "ndvi_z": round(f["predicted"], 2),
                          "low": round(f["low"], 2), "high": round(f["high"], 2), "light": f["light"],
                          "beats_baseline": bool(f["beats_baseline"])})
    years_n = {"1y": 1, "3y": 3, "5y": 5, "10y": 10}.get(horizon)
    scenario = None
    if years_n:
        scenario = build_scenario(series, zone, crop, sow, water, years_n, lat, lon, gh, area_ha)

    result = {
        "available": True, "zone": info, "crop": crop, "country": c["country"], "sow": sow, "irrigation": irrigation,
        "soil": soil, "area": area, "unit": unit, "area_ha": round(area_ha, 4), "lat": lat, "lon": lon,
        "score": chosen["score"], "risks": chosen["risks"], "heat_days": chosen["heat_days"],
        "key_months": chosen["key_months"], "history": chosen["history"],
        "months": [{"m": m["sow_month"], "score": m["score"], "typical": m["in_window"],
                    # a winter crop sown outside late summer/autumn gets no winter cold and does not head: no score shown
                    "viable": not c.get("winter") or m["sow_month"] in (8, 9, 10, 11)} for m in months],
        "best_month": best["sow_month"], "best_score": best["score"], "typical_months": c["sow"],
        "warnings": warnings, "soil_water": soil_out, "seed": seed, "harvest": harvest, "ghg": gh,
        "horizon": out_h, "scenario": scenario, "sources": SOURCES,
        "pixel": advisor.pixel_at(lat, lon, c["window"]),
    }
    return result


def build_scenario(series, zone, crop, sow, water, n_years, lat, lon, gh, area_ha):
    c = advisor.CROPS[crop]
    chosen = advisor.score_month(series, zone, crop, sow, water)
    key = chosen["key_months"]
    est = [sow, advisor.shift([sow], 1)[0]]
    start = season_start_year(sow)
    years_out = list(range(start, start + n_years))
    soil_key = yearly(series, zone, "soil_moisture_z", key)
    soil_sow = yearly(series, zone, "soil_moisture_z", [sow])
    rain = yearly(series, zone, "precip_z", est)
    temp = yearly(series, zone, "temp", key)
    raw_sm = yearly(series, zone, "soil_moisture", key)
    t_slope, _ = sen_slope(temp.values, temp.index.values)
    sm_slope, sm_icpt = sen_slope(raw_sm.values, raw_sm.index.values)
    sm_base = float(raw_sm[raw_sm.index <= 2021].mean()) if len(raw_sm) else None
    t_base = float(temp[temp.index <= 2021].mean()) if len(temp) else None
    _, t_icpt = sen_slope(temp.values, temp.index.values)
    p_trend = mk_p(raw_sm.values)
    co = co2()
    w = dict(advisor.WEIGHTS)
    wf = 1.0 if not water else (0.5 if water is True else float(water))
    for k in ("dry_sowing", "rain_fail", "dry_key"):
        w[k] *= wf
    country_crops = [k for k, v in advisor.CROPS.items() if v["country"] == c["country"]]

    def proj_score(cr, y):
        cc = advisor.CROPS[cr]
        base = advisor.score_month(series, zone, cr, cc["sow"][0] if cr != crop else sow, water)
        k2 = base["key_months"]
        s_k = yearly(series, zone, "soil_moisture_z", k2)
        s_s = yearly(series, zone, "soil_moisture_z", [base["sow_month"]])
        e2 = [base["sow_month"], advisor.shift([base["sow_month"]], 1)[0]]
        r2 = yearly(series, zone, "precip_z", e2)
        parts = dict(base["risks"])
        parts["dry_key"], _ = projected_prob_below(s_k.values, s_k.index.values, y)
        parts["dry_sowing"], _ = projected_prob_below(s_s.values, s_s.index.values, y)
        parts["rain_fail"], _ = projected_prob_below(r2.values, r2.index.values, y)
        used = {k: v for k, v in parts.items() if v is not None}
        tw = sum(advisor.WEIGHTS[k] for k in used)
        pen = sum(w[k] * v for k, v in used.items()) / tw if tw else 0
        return round(100 * (1 - pen)), parts

    cs = cell_scenario(c["country"], key, years_out, lat, lon)
    rows = []
    cum = 0.0
    for i, y in enumerate(years_out):
        score, parts = proj_score(crop, y)
        alts = []
        for cr in country_crops:
            if cr == crop or (advisor.CROPS[cr]["irrigated_only"] and not water):
                continue
            s2, _ = proj_score(cr, y)
            alts.append({"crop": cr, "score": s2})
        alts.sort(key=lambda a: -a["score"])
        cum += gh["total_t"]
        near = cs["nearest"] if cs else None
        rows.append({
            "year": y, "score": score,
            "dry_key_chance": None if parts["dry_key"] is None else round(parts["dry_key"], 2),
            "soil_mm_change": None if sm_slope is None else round(sm_icpt + sm_slope * y - sm_base, 1),
            "cell_mm_change": near["change_mm"][i] if near else None,
            "cell_dry_chance": near["dry_chance"][i] if near else None,
            "temp_change_c": None if t_slope is None else round(t_icpt + t_slope * y - t_base, 2),
            "co2_ppm": None if co is None else round(co["ppm"] + co["growth_ppm_per_year"] * (y - co["year"]), 1),
            "ghg_cum_t": round(cum, 2),
            "flag": "switch" if score < 50 else ("watch" if score < 65 else "ok"),
            "alternatives": alts[:2],
        })
    return {
        "years": years_out, "rows": rows, "base_year": 2025, "baseline": "2003-2021", "score_today": chosen["score"],
        "dry_key_today": chosen["risks"]["dry_key"], "soil_base_mm": None if sm_base is None else round(sm_base, 1),
        "soil_trend_mm_per_decade": None if sm_slope is None else round(sm_slope * 10, 1),
        "soil_trend_p": None if p_trend is None else round(p_trend, 3),
        "temp_trend_c_per_decade": None if t_slope is None else round(t_slope * 10, 2),
        "co2": co, "cells": cs,
    }


def spot(lat: float, lon: float) -> dict:
    """Facts for one clicked point: zone, the 0.05° MODIS cell for each crop window, best sowing month for each crop."""
    series = store.load("series")
    zones = store.load("zones")
    if series is None or zones is None:
        return {"available": False}
    country = "AU" if lat < 0 else "UA"
    zone = advisor.zone_for_point(lat, lon, country)
    info = logic.zone_info(zone)
    inside = bool(info["west"] <= lon <= info["east"] and info["south"] <= lat <= info["north"])
    irrigated_zone = info["zone_type"] == "irrigated" and zone != "UA_main"
    crops = []
    for k, v in advisor.CROPS.items():
        if v["country"] != country:
            continue
        water = 0.5 if (irrigated_zone or v["irrigated_only"]) else False
        sc = [advisor.score_month(series, zone, k, m, water) for m in v["sow"]]
        b = max(sc, key=lambda x: x["score"])
        px = advisor.pixel_at(lat, lon, v["window"])
        crops.append({"crop": k, "best_month": b["sow_month"], "score": b["score"], "needs_irrigation": v["irrigated_only"],
                      "land_score": px.get("best_land") if px and px.get("land") else None})
    crops.sort(key=lambda x: -x["score"])
    season = advisor.pixel_at(lat, lon, "season")
    cell = None
    if season and season.get("land"):
        cond = season["condition"]
        yrs = season["years"]
        cell = {"best_land": season["best_land"], "mean_ndvi": season["mean_ndvi"], "change": season["change"],
                "last_year": yrs[-1], "last_z": cond[-1], "poor_years": [y for y, z in zip(yrs, cond) if z is not None and z < -1],
                "n_years": len(yrs)}
    now = logic.now(zone)
    a = store.load("alerts")
    dry8 = None
    if a is not None:
        r = a[(a.zone == zone) & (a.type == "dry_spell_next8d")]
        if not r.empty:
            dry8 = int(r.iloc[-1].value)
    sm = yearly(series, zone, "soil_moisture", [4, 5, 6, 7, 8] if country == "UA" else [6, 7, 8, 9, 10])
    sm_slope, _ = sen_slope(sm.values, sm.index.values)
    return {
        "available": True, "lat": lat, "lon": lon, "zone": info, "inside_zone": inside, "cell": cell,
        "crops": crops,
        "now": {"condition": now["condition"], "light": now["light_now"],
                "forecast": [{"lead": f["lead_months"], "target": str(f["target_date"])[:7], "z": round(f["predicted"], 2), "light": f["light"]}
                             for f in now["forecast"] if f["lead_months"] <= 3]},
        "dry_spell_next8d_pct": dry8,
        "soil_trend_mm_per_decade": None if sm_slope is None else round(sm_slope * 10, 1),
        "soil_trend_p": mk_p(sm.values),
    }


LANG_NAME = {"en": "English", "uk": "Ukrainian", "de": "German", "fr": "French", "it": "Italian"}

SYS = """You are a farm advisor inside the app "Follow the Gas". Use ONLY the numbers in the JSON. Never invent numbers.
Write plain, short sentences for a farmer. No tables, no markdown headings, no asterisks.
Scores are 0-100 (higher = safer), computed from NASA satellite history 2003-2025. "dry chance" values are shares of past years.
The multi-year rows are a scenario "if the 2003-2025 trend continues", not a forecast; say so once.
Answer in {lang}."""


CROP_EN = {"winter_wheat": "winter wheat", "spring_barley": "spring barley", "maize": "maize", "sunflower": "sunflower",
           "soybean": "soybean", "wheat_au": "wheat", "canola": "canola", "barley_au": "barley", "rice": "irrigated rice",
           "cotton": "irrigated cotton"}
TIP_EN = {"n_minus_20": "use 20% less nitrogen (split doses after a soil test)", "no_urea": "switch from urea to ammonium nitrate",
          "notill": "move to no-till to burn less diesel", "rice_awd": "drain the rice field several times (alternate wetting and drying)",
          "no_leaching": "irrigate only what the crop needs so nitrogen is not washed below the roots"}
WARN_EN = {"crop_other_country": "crop calendar is from the other country", "outside_window": "sowing month is outside the usual window",
           "outside_window_winter": "winter wheat sown outside autumn will likely not form ears", "needs_irrigation": "this crop needs irrigation",
           "no_irrigation_system": "zone has no irrigation system", "kakhovka_water_lost": "Kakhovka canals have had no water since June 2023",
           "sandy_dry": "sandy soil stores little water"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def plan_messages(result: dict, notes: str, lang: str) -> list:
    keep = {k: result.get(k) for k in ("crop", "country", "sow", "irrigation", "soil", "area_ha", "score", "risks",
                                       "heat_days", "best_month", "best_score", "typical_months", "warnings", "soil_water",
                                       "seed", "harvest", "horizon")}
    keep["zone"] = result["zone"]["name_en"]
    keep["crop"] = CROP_EN[result["crop"]]
    keep["sow"] = MONTHS[result["sow"] - 1]
    keep["best_month"] = MONTHS[result["best_month"] - 1]
    keep["typical_months"] = [MONTHS[m - 1] for m in result["typical_months"]]
    keep["warnings"] = [WARN_EN.get(w, w) for w in result["warnings"]]
    g = result["ghg"]
    keep["ghg"] = {"per_ha_kg_co2e": g["per_ha_kg"], "total_t_co2e": g["total_t"], "parts_kg_ha": g["parts_kg_ha"],
                   "n_kg_ha": g["n_kg_ha"],
                   "ways_to_cut": [{"action": TIP_EN[t["code"]], "saves_t_co2e": t["save_t_total"], "pct": t["pct"]} for t in g["tips"]]}
    sc = result.get("scenario")
    fmt = "Write exactly:\nSUMMARY: 3-4 sentences judging this plan (score, main risk, what the farmer's notes change).\nTIP: one practical action for this field\nTIP: another practical action\nTIP: the best way to cut emissions (from ways_to_cut)"
    if sc:
        keep["scenario"] = {"soil_trend_mm_per_decade": sc["soil_trend_mm_per_decade"], "trend_p": sc["soil_trend_p"],
                            "rows": [{**{k: r[k] for k in ("year", "score", "dry_key_chance", "soil_mm_change", "temp_change_c", "flag")},
                                      "alternatives": [{"crop": CROP_EN[a["crop"]], "score": a["score"]} for a in r["alternatives"]]} for r in sc["rows"]]}
        fmt += "\nThen one line per scenario year:\nYEAR <year>: what to do or replant that season, in one short sentence (if flag is switch, name the best alternative)."
    body = json.dumps(keep, ensure_ascii=False, separators=(",", ":"), default=str)
    user = f"RESULTS JSON:\n{body}\n\nFARMER NOTES: {notes or '(none)'}\n\n{fmt}"
    return [{"role": "system", "content": SYS.format(lang=LANG_NAME.get(lang, "English"))}, {"role": "user", "content": user}]


def spot_messages(facts: dict, question: str, lang: str) -> list:
    f = json.loads(json.dumps(facts, default=str))
    f["zone"] = f["zone"]["name_en"]
    f["crops"] = [{**c, "crop": CROP_EN[c["crop"]], "best_month": MONTHS[c["best_month"] - 1]} for c in f["crops"]]
    f.pop("messages", None)
    body = json.dumps(f, ensure_ascii=False, separators=(",", ":"))
    q = question or "What is this spot good for, what is the main risk, and when should I sow?"
    user = f"FACTS FOR THE CLICKED SPOT JSON:\n{body}\n\nQUESTION: {q}\nAnswer in 3-5 short sentences."
    return [{"role": "system", "content": SYS.format(lang=LANG_NAME.get(lang, "English"))}, {"role": "user", "content": user}]
