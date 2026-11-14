"""Pixel-level crop-condition maps from NASA MODIS MOD13C2 NDVI (0.05 deg, about 5.5 km).

    python pipeline/build_pixel_maps.py      -> results/pixel_maps.json   (a few seconds)

Input: pipeline/pixels/modis_ndvi_pixels.parquet (month, region, lat, lon, ndvi). Pixels already passed the
MODIS reliability filter (0-1) and the water mask (2003-2021 median NDVI < 0.1 removed, so the Kakhovka reservoir
bed is not counted); failed pixels are NaN.

For every region, crop window (months that matter most for a crop) and year:
  condition  = z-score of the pixel's window-mean NDVI vs that same pixel's 2003-2021 window means
               (0 = normal for this pixel, -1 = clearly worse, +1 = clearly better)
  relative   = condition minus the regional mean condition that year (removes weather shared by the whole region)
Per window:
  best_land  = 0-100 score: 60% how green the pixel usually is (rank in its region) + 40% how steady it is
               (rank of low year-to-year variation), 2003-2021
  change     = mean 'relative' in an event period minus 2003-2021: Ukraine 2024-2025 (full seasons after the
               Kakhovka dam was destroyed on 6 Jun 2023), Australia 2018-2019 (drought)
Plus 'now'   = the latest month's NDVI as a z-score vs the same pixel and calendar month, 2003-2021.

No crop-type map is used: a window shows the condition of all vegetation in the months that matter for that crop.
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "pipeline" / "pixels" / "modis_ndvi_pixels.parquet"
OUT = ROOT / "results" / "pixel_maps.json"
RES = 0.05
BASE = (2003, 2021)

WINDOWS = {
    "UA": [
        {"id": "wheat", "months": [5, 6], "label_en": "Winter wheat and barley (May–Jun)", "label_uk": "Озима пшениця та ячмінь (трав–черв)"},
        {"id": "maize_sun", "months": [7, 8], "label_en": "Maize and sunflower (Jul–Aug)", "label_uk": "Кукурудза та соняшник (лип–серп)"},
        {"id": "season", "months": [4, 5, 6, 7, 8], "label_en": "Whole growing season (Apr–Aug)", "label_uk": "Увесь сезон (квіт–серп)"},
    ],
    "AU": [
        {"id": "wheat", "months": [8, 9, 10], "label_en": "Wheat and canola (Aug–Oct)", "label_uk": "Пшениця та ріпак (серп–жовт)"},
        {"id": "summer", "months": [1, 2], "label_en": "Irrigated summer crops: rice, cotton (Jan–Feb)", "label_uk": "Зрошувані літні: рис, бавовна (січ–лют)"},
        {"id": "season", "months": [6, 7, 8, 9, 10], "label_en": "Whole growing season (Jun–Oct)", "label_uk": "Увесь сезон (черв–жовт)"},
    ],
}
EVENTS = {
    "UA": {"years": [2024, 2025], "label_en": "After the Kakhovka dam (2024–2025 vs 2003–2021)", "label_uk": "Після Каховської ГЕС (2024–2025 проти 2003–2021)"},
    "AU": {"years": [2018, 2019], "label_en": "2018–19 drought (vs 2003–2021)", "label_uk": "Посуха 2018–19 (проти 2003–2021)"},
}


def pack(a, scale=10, lo=-40, hi=40):
    """float grid -> list of ints (value*scale, clipped), None where missing: small JSON."""
    out = np.where(np.isfinite(a), np.clip(np.round(a * scale), lo, hi), np.nan)
    return [None if not np.isfinite(v) else int(v) for v in out.ravel()]


def rank01(a):
    s = pd.Series(a.ravel())
    return s.rank(pct=True).to_numpy().reshape(a.shape)


def build():
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    d = pd.read_parquet(SRC)
    d["date"] = pd.to_datetime(d["month"])
    d["year"], d["m"] = d.date.dt.year, d.date.dt.month
    out = {"source": "NASA MODIS MOD13C2 v061 NDVI, 0.05°", "resolution": RES, "baseline": list(BASE),
           "last_month": d.date.max().strftime("%Y-%m"), "regions": {}}
    for reg, g in d.groupby("region"):
        lats = np.sort(g.lat.unique())[::-1]   # north -> south
        lons = np.sort(g.lon.unique())
        ri = {round(v, 3): i for i, v in enumerate(lats)}
        ci = {round(v, 3): i for i, v in enumerate(lons)}
        g = g.assign(r=g.lat.round(3).map(ri), c=g.lon.round(3).map(ci))
        nr, nc = len(lats), len(lons)
        years = sorted(g.year.unique())
        cube = np.full((len(years), 12, nr, nc), np.nan, dtype="float32")
        yi = {y: i for i, y in enumerate(years)}
        cube[g.year.map(yi).to_numpy(), g.m.to_numpy() - 1, g.r.to_numpy(), g.c.to_numpy()] = g.ndvi.to_numpy()
        base = np.array([BASE[0] <= y <= BASE[1] for y in years])
        land = np.isfinite(cube).any(axis=(0, 1))

        reg_out = {"west": float(lons.min() - RES / 2), "east": float(lons.max() + RES / 2),
                   "north": float(lats.max() + RES / 2), "south": float(lats.min() - RES / 2),
                   "nrows": nr, "ncols": nc, "years": [int(y) for y in years], "windows": [], "event": EVENTS[reg]}
        for w in WINDOWS[reg]:
            mi = [m - 1 for m in w["months"]]
            sub = cube[:, mi]
            n_ok = np.isfinite(sub).sum(axis=1)
            with np.errstate(all="ignore"):
                wm = np.where(n_ok >= max(1, len(mi) // 2 + len(mi) % 2), np.nanmean(sub, axis=1), np.nan)
                mu = np.nanmean(wm[base], axis=0)
                sd = np.nanstd(wm[base], axis=0, ddof=1)
                z = (wm - mu) / np.where(sd > 1e-4, sd, np.nan)
                rel = z - np.nanmean(z, axis=(1, 2), keepdims=True)
                ev = np.array([y in EVENTS[reg]["years"] for y in years])
                change = np.nanmean(rel[ev], axis=0) - np.nanmean(rel[base], axis=0)
                cv = sd / mu
            prod, steady = rank01(np.where(land, mu, np.nan)), 1 - rank01(np.where(land, cv, np.nan))
            best = np.where(land & np.isfinite(mu) & np.isfinite(cv), 100 * (0.6 * prod + 0.4 * steady), np.nan)
            reg_mean = [None if not np.isfinite(v) else round(float(v), 3) for v in np.nanmean(z, axis=(1, 2))]
            reg_out["windows"].append({
                **w,
                "condition": [pack(z[i]) for i in range(len(years))],   # z * 10
                "region_mean": reg_mean,                                 # z, per year
                "best_land": pack(best, scale=1, lo=0, hi=100),
                "change": pack(change),                                  # z * 10
                "mean_ndvi": pack(mu, scale=1000, lo=0, hi=1000),        # NDVI * 1000
            })
        # latest month vs same pixel & calendar month
        last = d.date.max()
        lm = last.month - 1
        with np.errstate(all="ignore"):
            mu_m = np.nanmean(cube[base, lm], axis=0)
            sd_m = np.nanstd(cube[base, lm], axis=0, ddof=1)
            now = (cube[yi[last.year], lm] - mu_m) / np.where(sd_m > 1e-4, sd_m, np.nan)
        reg_out["now"] = {"month": last.strftime("%Y-%m"), "z": pack(now)}
        out["regions"][reg] = reg_out
        print(f"{reg}: {nr}x{nc} pixels, {land.sum()} land, years {years[0]}-{years[-1]}")
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
    return out


if __name__ == "__main__":
    o = build()
    # sanity: dam change in the Kakhovka box should be negative on average
    ua = o["regions"]["UA"]
    w = next(x for x in ua["windows"] if x["id"] == "season")
    ch = np.array([np.nan if v is None else v / 10 for v in w["change"]]).reshape(ua["nrows"], ua["ncols"])
    lat = ua["north"] - 0.025 - 0.05 * np.arange(ua["nrows"])
    lon = ua["west"] + 0.025 + 0.05 * np.arange(ua["ncols"])
    def box(w_, s, e, n):
        r = (lat >= s) & (lat <= n); c = (lon >= w_) & (lon <= e)
        return np.nanmean(ch[np.ix_(r, c)])
    print("season change, Kakhovka box:", round(box(33.3, 46.2, 35.3, 47.0), 2),
          "| North Mykolaiv box:", round(box(31.0, 47.0, 32.5, 47.8), 2),
          "| Southern Dnipropetrovsk box:", round(box(33.5, 47.4, 34.8, 47.9), 2))
