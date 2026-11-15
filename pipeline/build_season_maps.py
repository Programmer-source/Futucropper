"""Seasonal field-greenness maps from NASA MODIS MOD13C2 NDVI (0.05 deg), for the "See the Future" tab.

    python pipeline/build_season_maps.py      -> results/season_maps.json   (a few seconds)

Input: pipeline/pixels/modis_ndvi_pixels.parquet (month, region, lat, lon, ndvi), the same file and the same grid
geometry as pipeline/build_pixel_maps.py (rows north -> south, 0.05 deg cells).
Seasons by months: DJF (Dec-Feb, December counts toward the NEXT year), MAM, JJA, SON.
For every region, year 2003-2025 and season:
  mean NDVI per cell over the season's months (needs at least 2 of the 3 months),
  z-score vs the same cell's 2003-2021 mean and std of that SAME season, stored as int z*10 (None = water/no data).
Water mask as in the existing pipeline: cells whose 2003-2021 median NDVI < 0.1 are removed.
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "pipeline" / "pixels" / "modis_ndvi_pixels.parquet"
OUT = ROOT / "results" / "season_maps.json"
RES = 0.05
BASE = (2003, 2021)
YEARS = (2003, 2025)
SEASONS = {"DJF": [12, 1, 2], "MAM": [3, 4, 5], "JJA": [6, 7, 8], "SON": [9, 10, 11]}


def pack(a, scale=10, lo=-40, hi=40):
    out = np.where(np.isfinite(a), np.clip(np.round(a * scale), lo, hi), np.nan)
    return [None if not np.isfinite(v) else int(v) for v in out.ravel()]


def season_year(date):
    """December belongs to the next year's DJF."""
    return date.year + 1 if date.month == 12 else date.year


def build():
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    d = pd.read_parquet(SRC)
    d["date"] = pd.to_datetime(d["month"])
    d["m"] = d.date.dt.month
    d["sy"] = d.date.dt.year + (d.m == 12).astype(int)
    d["season"] = d.m.map({m: s for s, ms in SEASONS.items() for m in ms})
    out = {"source": "NASA MODIS MOD13C2 v061 NDVI, 0.05°", "resolution": RES, "baseline": list(BASE),
           "seasons": SEASONS, "regions": {}}
    years = list(range(YEARS[0], YEARS[1] + 1))
    base = np.array([BASE[0] <= y <= BASE[1] for y in years])
    for reg, g in d.groupby("region"):
        lats = np.sort(g.lat.unique())[::-1]   # north -> south, as build_pixel_maps.py
        lons = np.sort(g.lon.unique())
        ri = {round(v, 3): i for i, v in enumerate(lats)}
        ci = {round(v, 3): i for i, v in enumerate(lons)}
        g = g.assign(r=g.lat.round(3).map(ri), c=g.lon.round(3).map(ci))
        nr, nc = len(lats), len(lons)

        # water mask: median NDVI over all 2003-2021 calendar months < 0.1
        gb = g[(g.date.dt.year >= BASE[0]) & (g.date.dt.year <= BASE[1])]
        med = np.full((nr, nc), np.nan)
        mg = gb.groupby(["r", "c"]).ndvi.median()
        med[mg.index.get_level_values(0), mg.index.get_level_values(1)] = mg.to_numpy()
        water = ~(med >= 0.1)

        reg_out = {"west": float(lons.min() - RES / 2), "east": float(lons.max() + RES / 2),
                   "north": float(lats.max() + RES / 2), "south": float(lats.min() - RES / 2),
                   "nrows": nr, "ncols": nc, "years": years, "z": {}}
        for s in SEASONS:
            gs = g[(g.season == s) & (g.sy >= YEARS[0]) & (g.sy <= YEARS[1])]
            agg = gs.groupby(["sy", "r", "c"]).ndvi.agg(["mean", "count"])
            agg = agg[agg["count"] >= 2]
            cube = np.full((len(years), nr, nc), np.nan)
            yi = agg.index.get_level_values(0).to_numpy() - YEARS[0]
            cube[yi, agg.index.get_level_values(1), agg.index.get_level_values(2)] = agg["mean"].to_numpy()
            cube[:, water] = np.nan
            with np.errstate(all="ignore"):
                mu = np.nanmean(cube[base], axis=0)
                sd = np.nanstd(cube[base], axis=0, ddof=1)
                z = (cube - mu) / np.where(sd > 1e-4, sd, np.nan)
            reg_out["z"][s] = [pack(z[i]) for i in range(len(years))]
        out["regions"][reg] = reg_out
        print(f"{reg}: {nr}x{nc} cells, {int((~water).sum())} land, seasons {years[0]}-{years[-1]}")
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
    return out


def hand_check(o, reg="UA", season="JJA", year=2024):
    """Recompute one land cell straight from the parquet with plain pandas and compare with the file."""
    r = o["regions"][reg]
    grid = r["z"][season][year - YEARS[0]]
    k = next(i for i, v in enumerate(grid) if v is not None and i > len(grid) // 2)
    row, col = divmod(k, r["ncols"])
    lat = round(r["north"] - RES / 2 - row * RES, 3)
    lon = round(r["west"] + RES / 2 + col * RES, 3)
    d = pd.read_parquet(SRC)
    d = d[(d.region == reg) & (d.lat.round(3) == lat) & (d.lon.round(3) == lon)].copy()
    d["date"] = pd.to_datetime(d["month"])
    d["sy"] = d.date.dt.year + (d.date.dt.month == 12).astype(int)
    d = d[d.date.dt.month.isin(SEASONS[season])]
    per_year = d.groupby("sy").ndvi.agg(["mean", "count"])
    per_year = per_year[per_year["count"] >= 2]["mean"]
    b = per_year[(per_year.index >= BASE[0]) & (per_year.index <= BASE[1])]
    z = (per_year[year] - b.mean()) / b.std(ddof=1)
    by_hand = int(np.clip(np.round(z * 10), -40, 40))
    print(f"check {reg} {season} {year} cell lat {lat} lon {lon}: months {d[d.sy == year].month.tolist()} "
          f"ndvi {d[d.sy == year].ndvi.round(4).tolist()} -> mean {per_year[year]:.4f}, base mean {b.mean():.4f}, "
          f"base sd {b.std(ddof=1):.4f}, z {z:.3f} -> by hand {by_hand}, file {grid[k]}  "
          f"{'MATCH' if by_hand == grid[k] else 'MISMATCH'}")
    return by_hand == grid[k]


if __name__ == "__main__":
    o = build()
    assert hand_check(o, "UA", "JJA", 2024)
    assert hand_check(o, "AU", "DJF", 2019)
