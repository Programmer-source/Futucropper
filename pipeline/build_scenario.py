"""Per-cell NASA GLDAS Noah 2.1 (0.25°) monthly history for the multi-year scenario map.

Writes results/scenario_cells.json: for every land cell, root-zone soil moisture 0-40 cm (kg/m² = mm,
SoilMoi0_10cm + SoilMoi10_40cm) and air temperature (°C) for each calendar month, one value per year 2003-2025.
The backend fits Sen's slope on the months a crop cares about and extends it ("if the trend continues").
Run: python pipeline/build_scenario.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
d = pd.read_csv(ROOT / "pipeline/gldas/gldas_raw_cells.csv")
d = d.replace(-9999, np.nan)
d["sm"] = d["SoilMoi0_10cm_inst"] + d["SoilMoi10_40cm_inst"]
d["t"] = d["Tair_f_inst"] - 273.15
d["year"] = d["month"].str[:4].astype(int)
d["mon"] = d["month"].str[5:7].astype(int)
years = sorted(d["year"].unique().tolist())
out = {"source": "NASA GLDAS Noah 2.1 monthly, 0.25°", "years": years, "resolution": 0.25, "regions": {}}
for reg, g in d.groupby("region"):
    cells = []
    for (lat, lon), c in g.groupby(["lat", "lon"]):
        if c["sm"].isna().all():
            continue
        sm = c.pivot_table(index="mon", columns="year", values="sm").reindex(index=range(1, 13), columns=years)
        t = c.pivot_table(index="mon", columns="year", values="t").reindex(index=range(1, 13), columns=years)
        cells.append({"lat": float(lat), "lon": float(lon),
                      "sm": [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in sm.values],
                      "t": [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in t.values]})
    out["regions"][reg] = {"cells": cells}
    print(reg, len(cells), "cells")
p = ROOT / "results/scenario_cells.json"
p.write_text(json.dumps(out, separators=(",", ":")))
print(p, p.stat().st_size // 1024, "KB")
