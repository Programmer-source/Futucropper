"""Planting advisor: "I want to grow <crop> in <place>; when should I sow, and how risky is it?"

Everything is computed from the zone's NASA monthly history (2003-2025; heat and frost days from 2015):
for each sowing month the crop allows, how often in past years the soil was dry at sowing, rain failed in
the establishment month, the soil was dry during the crop's sensitive window, how hot that window was, and
(spring crops) how often frost followed sowing. A later sowing shifts the sensitive window by the same months.

The crop calendars are typical regional windows from general agronomy, not field-specific advice; the page says so.
Returns codes and numbers only; all wording lives in the frontend translation files.
"""
import json
from functools import lru_cache

import numpy as np
import pandas as pd

from . import logic, store

# crop: country, sowing months, sensitive window (for the first sowing month), frost-sensitive after sowing,
#       needs irrigation, pixel-map window id
CROPS = {
    "winter_wheat": {"country": "UA", "sow": [9, 10], "key": [5, 6], "frost": False, "irrigated_only": False, "window": "wheat", "winter": True},
    "spring_barley": {"country": "UA", "sow": [3, 4], "key": [6], "frost": True, "irrigated_only": False, "window": "wheat"},
    "maize": {"country": "UA", "sow": [4, 5], "key": [7], "frost": True, "irrigated_only": False, "window": "maize_sun"},
    "sunflower": {"country": "UA", "sow": [4, 5], "key": [7, 8], "frost": True, "irrigated_only": False, "window": "maize_sun"},
    "soybean": {"country": "UA", "sow": [4, 5], "key": [7, 8], "frost": True, "irrigated_only": False, "window": "maize_sun"},
    "wheat_au": {"country": "AU", "sow": [4, 5, 6], "key": [9, 10], "frost": False, "flower_frost": True, "irrigated_only": False, "window": "wheat"},
    "canola": {"country": "AU", "sow": [4, 5], "key": [8, 9], "frost": False, "flower_frost": True, "irrigated_only": False, "window": "wheat"},
    "barley_au": {"country": "AU", "sow": [5, 6], "key": [9, 10], "frost": False, "flower_frost": True, "irrigated_only": False, "window": "wheat"},
    "rice": {"country": "AU", "sow": [10, 11], "key": [1, 2], "frost": False, "irrigated_only": True, "window": "summer"},
    "cotton": {"country": "AU", "sow": [10, 11], "key": [1, 2], "frost": True, "irrigated_only": True, "window": "summer"},
}
WEIGHTS = {"dry_sowing": 0.30, "rain_fail": 0.20, "dry_key": 0.25, "heat": 0.15, "frost": 0.10}
DAM_DATE = pd.Timestamp("2023-06-06")


def shift(months, k):
    return [((m - 1 + k) % 12) + 1 for m in months]


def _pivot(series, zone, var):
    s = series[(series["zone"] == zone) & (series["variable"] == var)].set_index("date")["value"]
    return s


def _month_vals(s, month):
    return s[s.index.month == month]


def score_month(series, zone, crop, sow, irrigated):
    c = CROPS[crop]
    # any month may be chosen: months outside the usual window shift the sensitive window by the same offset
    k = c["sow"].index(sow) if sow in c["sow"] else ((sow - c["sow"][0] + 6) % 12) - 6
    # winter crops wait out the winter, so a later autumn sowing barely moves the spring window
    key = c["key"] if (c.get("winter") and sow in c["sow"]) else shift(c["key"], k)
    soil = _pivot(series, zone, "soil_moisture_z")
    rain = _pivot(series, zone, "precip_z")
    heat = _pivot(series, zone, "heat_days_35")
    frost = _pivot(series, zone, "frost_days")
    ndvi = _pivot(series, zone, "ndvi_z")

    sow_soil = _month_vals(soil, sow)
    p_dry_sow = float((sow_soil < -1).mean()) if len(sow_soil) else None
    est = [sow, shift([sow], 1)[0]]
    r = rain[rain.index.month.isin(est)]
    r_year = r.groupby(r.index.year).mean()
    p_rain_fail = float((r_year < -1).mean()) if len(r_year) else None
    ks = soil[soil.index.month.isin(key)]
    ks_year = ks.groupby(ks.index.year).mean()
    p_dry_key = float((ks_year < -1).mean()) if len(ks_year) else None
    kh = heat[heat.index.month.isin(key)]
    heat_days = float(kh.groupby(kh.index.year).sum().mean()) if len(kh) else None
    heat_risk = None if heat_days is None else min(1.0, heat_days / (5.0 * len(key)))  # 5+ days above 35 °C a month = full heat risk
    frost_risk = None
    frost_month = None
    if c.get("frost"):
        frost_month = shift([sow], 1)[0]
    if c.get("flower_frost"):
        frost_month = key[0]
    if frost_month is not None:
        f = _month_vals(frost, frost_month)
        frost_risk = float((f >= 3).mean()) if len(f) else None

    w = dict(WEIGHTS)
    water = 0.5 if irrigated is True else (1.0 if not irrigated else float(irrigated))
    for kk in ("dry_sowing", "rain_fail", "dry_key"):  # canal water lowers the weight of rain and soil risks
        w[kk] *= water
    parts = {"dry_sowing": p_dry_sow, "rain_fail": p_rain_fail, "dry_key": p_dry_key, "heat": heat_risk, "frost": frost_risk}
    used = {kk: v for kk, v in parts.items() if v is not None}
    total_w = sum(WEIGHTS[kk] for kk in used)  # renormalise on available parts, max penalty stays comparable
    penalty = sum(w[kk] * v for kk, v in used.items()) / total_w if total_w else 0
    score = round(100 * (1 - penalty))

    # history of the sensitive window: field greenness by year
    kn = ndvi[ndvi.index.month.isin(key)]
    hist = []
    for y, g in kn.groupby(kn.index.year):
        z = float(g.mean())
        hist.append({"year": int(y), "z": round(z, 2), "light": logic.light(z)})
    return {
        "sow_month": sow, "key_months": key, "score": score,
        "risks": {kk: (None if v is None else round(v, 2)) for kk, v in parts.items()},
        "heat_days": None if heat_days is None else round(heat_days, 1),
        "frost_month": frost_month, "history": hist, "in_window": sow in c["sow"],
    }


@lru_cache(maxsize=4)
def _pixels(mtime: float):
    return json.loads((store.ROOT / "results" / "pixel_maps.json").read_text())


def pixels():
    p = store.ROOT / "results" / "pixel_maps.json"
    return _pixels(p.stat().st_mtime) if p.exists() else None


def pixel_at(lat, lon, window_id):
    px = pixels()
    if px is None or lat is None or lon is None:
        return None
    for reg, r in px["regions"].items():
        if r["west"] <= lon <= r["east"] and r["south"] <= lat <= r["north"]:
            row = int((r["north"] - lat) / px["resolution"])
            col = int((lon - r["west"]) / px["resolution"])
            row, col = min(row, r["nrows"] - 1), min(col, r["ncols"] - 1)
            i = row * r["ncols"] + col
            w = next((x for x in r["windows"] if x["id"] == window_id), None)
            if w is None:
                return None
            cond = [None if yr[i] is None else yr[i] / 10 for yr in w["condition"]]
            if all(v is None for v in cond):
                return {"region": reg, "row": row, "col": col, "land": False}
            return {"region": reg, "row": row, "col": col, "land": True, "best_land": w["best_land"][i],
                    "mean_ndvi": None if w["mean_ndvi"][i] is None else w["mean_ndvi"][i] / 1000,
                    "change": None if w["change"][i] is None else w["change"][i] / 10,
                    "years": r["years"], "condition": cond}
    return None


def zone_for_point(lat, lon, country=None):
    zones = store.load("zones")
    if zones is None:
        return None
    inside = zones[(zones.west <= lon) & (zones.east >= lon) & (zones.south <= lat) & (zones.north >= lat)]
    if not inside.empty:
        return inside.iloc[0]["zone"]
    z = zones if country is None else zones[zones.country == country]
    d = (z.lat - lat) ** 2 + (z.lon - lon) ** 2
    return z.loc[d.idxmin(), "zone"]


def advise(zone, crop, sow=None, irrigated=False, lat=None, lon=None):
    series = store.load("series")
    info = logic.zone_info(zone)
    if series is None or info is None or crop not in CROPS:
        return {"available": False}
    c = CROPS[crop]
    warnings = []
    if c["country"] != info["country"]:
        warnings.append("crop_other_country")
    if c["irrigated_only"] and not irrigated:
        warnings.append("needs_irrigation")
    if irrigated and info["zone_type"] != "irrigated":
        warnings.append("no_irrigation_system")
    if irrigated and zone == "UA_main":
        warnings.append("kakhovka_water_lost")
    months = [score_month(series, zone, crop, m, irrigated) for m in c["sow"]]
    best = max(months, key=lambda x: x["score"])
    chosen = next((x for x in months if x["sow_month"] == sow), best)

    # same crop, same plan, every zone of the country
    zones = store.load("zones")
    ranking = []
    for z in zones[zones.country == c["country"]].itertuples():
        irr = irrigated and z.zone_type == "irrigated" and z.zone != "UA_main"
        sc = [score_month(series, z.zone, crop, m, irr)["score"] for m in c["sow"]]
        ranking.append({"zone": z.zone, "best_score": max(sc), "best_month": c["sow"][int(np.argmax(sc))], "irrigation_counted": irr})
    ranking.sort(key=lambda r: -r["best_score"])

    now = logic.now(zone)
    outlook = {"condition": now["condition"], "light_now": now["light_now"], "forecast": now["forecast"],
               "soil_z": next((ch["z"] for ch in (now["why"] or {}).get("chain", []) if ch["variable"] == "soil_moisture"), None)}
    return {
        "available": True, "zone": info, "crop": crop, "country": c["country"], "irrigated": irrigated,
        "best": best, "chosen": chosen, "months": months, "ranking": ranking, "warnings": warnings,
        "outlook": outlook, "pixel": pixel_at(lat, lon, c["window"]), "weights": WEIGHTS,
        "data": {"history_years": "2003-2025", "heat_frost_years": "2015-2025"},
    }


def options():
    return {k: {"country": v["country"], "sow": v["sow"], "key": v["key"], "irrigated_only": v["irrigated_only"], "window": v["window"]}
            for k, v in CROPS.items()}
