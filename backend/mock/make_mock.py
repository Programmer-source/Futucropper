"""
Writes INVENTED data in the agreed file formats (see CONTRACTS.md) so the app can be built
before real results exist.   Run from the repo root:   python backend/mock/make_mock.py
Every series row has source = "MOCK"; the app shows a demo banner while mock data is present.
Real files from the data/model team overwrite these with the same names and columns.
"""
from pathlib import Path

import numpy as np
import pandas as pd
import pymannkendall as mk
from scipy.stats import theilslopes

ROOT = Path(__file__).resolve().parents[2]

import sys
if "--force" not in sys.argv:
    sys.exit("Real data is in data/ and results/ now. This script would overwrite it with invented demo data.\n"
             "Run it only on a copy, with:  python backend/mock/make_mock.py --force")
rng = np.random.default_rng(7)
DATES = pd.date_range("2003-01-01", "2026-10-01", freq="MS")
N, M = len(DATES), DATES.month.values
YRS = (DATES.year.values - 2003) + (M - 1) / 12
CLIM = (DATES.year >= 2003) & (DATES.year <= 2021)          # baseline for anomalies

# zone, country, zone_type, name_uk, name_en, lat, lon, half-size deg (placeholder boxes: Person 1 owns real ones)
ZONES = [
    ("UA_main", "UA", "irrigated", "Каховський зрошувальний масив", "Kakhovka irrigation area", 46.55, 33.85, 0.45),
    ("UA_second", "UA", "irrigated", "Південь Дніпропетровщини", "Southern Dnipropetrovsk", 47.55, 34.10, 0.40),
    ("UA_control", "UA", "control", "Миколаївщина, без зрошення", "Mykolaiv, rainfed", 47.35, 31.85, 0.40),
    ("AU_main", "AU", "irrigated", "Зрошувальний район Маррамбіджі", "Murrumbidgee irrigation area", -34.30, 146.05, 0.40),
    ("AU_control", "AU", "control", "Темора, без зрошення", "Temora, rainfed", -34.45, 147.53, 0.40),
]
UNITS = {"ndvi": "index", "ndvi_z": "z", "ndvi_pct_normal": "%", "precip": "mm/day", "precip_z": "z",
         "soil_moisture": "kg/m2", "soil_moisture_z": "z", "evap": "mm/day", "vpd": "kPa", "vpd_z": "z",
         "temp": "degC", "temp_z": "z", "heat_days_30": "days", "dry_spell_max": "days", "grace_tws": "cm", "oni": "degC"}


def ar1(n, phi, sd):
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = phi * x[i - 1] + rng.normal(0, sd)
    return x


ONI = np.clip(ar1(N, 0.93, 0.22), -2.0, 2.6)
ONI[-6:] = [0.9, 1.3, 1.6, 1.9, 2.2, 2.4]                      # strong El Nino in 2026, as in reality


def zscore(x):
    s = pd.Series(x)
    g = s[CLIM].groupby(M[CLIM])
    mu, sd = g.mean(), g.std()
    return ((s - mu.reindex(M).values) / sd.reindex(M).values).values


def irrigation(zone):
    f = np.ones(N)
    if zone in ("UA_main", "UA_second"):
        f[DATES >= "2023-06-01"] = 0.25 if zone == "UA_main" else 0.4
    if zone == "AU_main":
        f[(DATES >= "2006-07-01") & (DATES < "2008-01-01")] = 0.45
        f[(DATES >= "2018-07-01") & (DATES < "2020-01-01")] = 0.5
        rec = (DATES >= "2020-01-01") & (DATES < "2021-02-01")  # ~13 months to recover
        f[rec] = np.linspace(0.5, 1, rec.sum())
    return f


rows, eva = [], []
for zone, country, ztype, *_ in ZONES:
    south = country == "AU"
    season = np.cos(2 * np.pi * (M - (1 if south else 7)) / 12)
    grow = np.clip(np.cos(2 * np.pi * (M - (10 if south else 5)) / 12), 0, None)
    enso = ONI * (-0.4 if south else -0.04)
    temp = (17 if south else 10.5) + 11 * season + 0.09 * YRS + rng.normal(0, 1.0, N)
    precip = np.clip((1.3 if south else 1.6) + 0.45 * enso + rng.gamma(2, 0.35, N) - 0.7 - 0.01 * YRS, 0.02, None)
    soil = 20 + 6 * pd.Series(precip).rolling(3, min_periods=1).mean().values - 0.25 * (temp - temp.mean()) \
        - 0.07 * YRS + rng.normal(0, 1.0, N)
    vpd = np.clip(0.4 + 0.07 * (temp - 5) - 0.02 * (soil - 20) + rng.normal(0, 0.07, N), 0.05, None)
    evap = np.clip(0.3 + 0.12 * np.clip(temp, 0, None) * np.clip(soil / 25, 0.2, 1.2) + rng.normal(0, 0.12, N), 0.05, None)
    heat30 = np.clip(np.round((temp - (22 if south else 18)) * 1.6 * (temp > (22 if south else 18)) + rng.normal(0, 1, N)), 0, 31)
    dry = np.clip(np.round(14 - 5 * precip + rng.normal(0, 3, N)), 1, 31)
    grace = -0.35 * YRS + 3 * season + 4 * enso + rng.normal(0, 1.0, N)

    soil_anom = soil - pd.Series(soil).groupby(M).transform("mean").values
    base = 0.22 + 0.30 * grow + 0.008 * soil_anom - 0.04 * (vpd - vpd.mean())
    irr = 0.18 * grow if ztype == "irrigated" else 0
    expected = np.clip(base + irr, 0.05, 0.9)
    actual = np.clip(base + irr * irrigation(zone) + rng.normal(0, 0.012, N), 0.03, 0.9)
    if ztype == "control":
        actual = np.clip(expected + rng.normal(0, 0.012, N), 0.03, 0.9)
    # 2026: dry autumn in southern Ukraine, El Nino starting to dry Australia (invented, for the demo story)
    recent = DATES >= "2026-06-01"
    if country == "UA":
        precip[recent] *= 0.55
        soil[recent] -= 4
        actual[recent] *= {"UA_main": 0.72, "UA_second": 0.82, "UA_control": 0.93}[zone]
    else:
        actual[DATES >= "2026-08-01"] *= 0.9 if ztype == "irrigated" else 0.94
    clim_ndvi = pd.Series(actual)[CLIM].groupby(M[CLIM]).mean().reindex(M).values

    cols = {"ndvi": actual, "ndvi_z": zscore(actual), "ndvi_pct_normal": (actual / clim_ndvi - 1) * 100,
            "precip": precip, "precip_z": zscore(precip), "soil_moisture": soil, "soil_moisture_z": zscore(soil),
            "evap": evap, "vpd": vpd, "vpd_z": zscore(vpd), "temp": temp, "temp_z": zscore(temp),
            "heat_days_30": heat30, "dry_spell_max": dry, "grace_tws": grace, "oni": ONI}
    for var, v in cols.items():
        rows.append(pd.DataFrame({"zone": zone, "country": country, "zone_type": ztype, "variable": var, "date": DATES,
                                  "value": np.round(v, 4), "unit": UNITS[var], "source": "MOCK"}))
    band = 0.035
    eva.append(pd.DataFrame({"zone": zone, "date": DATES, "actual": actual.round(4), "expected": expected.round(4),
                             "expected_low": (expected - band).round(4), "expected_high": (expected + band).round(4),
                             "gap": (actual - expected).round(4), "gap_pct": ((actual - expected) / expected * 100).round(2)}))

series = pd.concat(rows, ignore_index=True)
eva = pd.concat(eva, ignore_index=True)

# --- trends: growing-season means, Sen slope, modified Mann-Kendall, Benjamini-Hochberg correction
GROW = {"UA": [4, 5, 6, 7, 8, 9], "AU": [6, 7, 8, 9, 10, 11]}
TREND_VARS = ["ndvi", "precip", "soil_moisture", "evap", "vpd", "temp", "heat_days_30", "dry_spell_max", "grace_tws"]
tr = []
for (zone, country, var), g in series[series["variable"].isin(TREND_VARS)].groupby(["zone", "country", "variable"]):
    g = g[g["date"].dt.month.isin(GROW[country]) & (g["date"].dt.year <= 2025)]
    y = g.groupby(g["date"].dt.year)["value"].mean()
    r = mk.hamed_rao_modification_test(y.values)
    s, _, lo, hi = theilslopes(y.values, y.index.values)
    tr.append({"zone": zone, "variable": var, "season": "growing", "slope_per_decade": round(s * 10, 4),
               "ci_low": round(lo * 10, 4), "ci_high": round(hi * 10, 4), "p_value": round(r.p, 5), "unit": UNITS[var]})
trends = pd.DataFrame(tr)
pv = trends["p_value"].fillna(1.0).values
idx = np.argsort(pv)
bh = pv[idx] * len(pv) / np.arange(1, len(pv) + 1)
bh = np.minimum.accumulate(bh[::-1])[::-1]
fdr = np.empty(len(pv))
fdr[idx] = np.minimum(bh, 1)
trends["p_value"] = pv
trends["p_value_fdr"] = np.round(fdr, 5)
trends["significant"] = trends["p_value_fdr"] < 0.05
trends["badge"] = np.where(trends["significant"], "confirmed", np.where(trends["p_value"] < 0.2, "possible", "none"))
trends["years_to_significance"] = [None if s else int(rng.integers(5, 30)) for s in trends["significant"]]

# --- lags (invented) for the drought chain
chain = [("oni", "precip"), ("temp", "vpd"), ("precip", "soil_moisture"), ("soil_moisture", "evap"),
         ("soil_moisture", "ndvi"), ("vpd", "ndvi")]
LAG = {"UA": [(4, -0.06), (0, 0.71), (1, 0.58), (0, 0.41), (2, 0.47), (0, -0.36)],
       "AU": [(3, -0.43), (0, 0.69), (1, 0.62), (0, 0.45), (1, 0.55), (0, -0.44)]}
lags = pd.DataFrame([{"country": c, "from_var": a, "to_var": b, "lag_months": l, "corr": r,
                      "p_value_fdr": 0.41 if abs(r) < 0.1 else round(10 ** (-6 * abs(r)), 6),
                      "significant": abs(r) >= 0.1}
                     for c, vals in LAG.items() for (a, b), (l, r) in zip(chain, vals)])

# --- forecast of ndvi_z: horizons 1, 3, 6 months, 80% band from the quantile model
issue = pd.Timestamp("2026-11-01")
PRED = {"UA_main": [-1.6, -1.4, -1.1], "UA_second": [-1.1, -0.9, -0.7], "UA_control": [-0.2, -0.4, -0.3],
        "AU_main": [-0.6, -0.9, -1.2], "AU_control": [-0.3, -0.6, -0.8]}
fc = []
for zone, preds in PRED.items():
    for lead, p in zip([1, 3, 6], preds):
        w = 0.45 + 0.12 * lead
        fc.append({"zone": zone, "issue_date": issue, "target_date": issue + pd.DateOffset(months=lead - 1),
                   "lead_months": lead, "predicted": p, "low": round(p - w, 2), "high": round(p + w, 2),
                   "beats_baseline": lead < 6 or zone.startswith("AU")})
forecast = pd.DataFrame(fc)

skill = pd.DataFrame([{"zone": z[0], "country": z[1], "horizon": h, "model": "weather_only",
                       "rmse": round(0.45 + 0.1 * h + rng.normal(0, 0.03), 3),
                       "rmse_persistence": round(0.6 + 0.16 * h, 3), "rmse_climatology": 1.0,
                       "class_accuracy": round(0.78 - 0.03 * h + rng.normal(0, 0.02), 2),
                       "drought_hit_rate": round(0.74 - 0.04 * h, 2), "coverage80": round(0.79 + rng.normal(0, 0.02), 2),
                       "r2": round(0.72 - 0.06 * h, 2)} for z in ZONES for h in (1, 3, 6)])

imp = []
for country, feats in {"UA": ["soil_moisture", "precip", "vpd", "temp", "evap", "oni"],
                       "AU": ["oni", "precip", "soil_moisture", "vpd", "temp", "evap"]}.items():
    w = np.sort(rng.dirichlet(np.ones(6) * 2))[::-1]
    imp += [{"country": country, "feature": f, "importance": round(v, 3), "rank": i + 1} for i, (f, v) in enumerate(zip(feats, w))]
importance = pd.DataFrame(imp)

# --- 8-day weather alerts (latest period)
p0, p1 = pd.Timestamp("2026-11-06"), pd.Timestamp("2026-11-13")
alerts = pd.DataFrame([
    {"zone": "UA_main", "period_start": p0, "period_end": p1, "type": "dry_spell", "value": 18, "unit": "days", "percentile": 92, "active": True},
    {"zone": "UA_main", "period_start": p0, "period_end": p1, "type": "frost", "value": 2, "unit": "days", "percentile": 40, "active": False},
    {"zone": "UA_second", "period_start": p0, "period_end": p1, "type": "dry_spell", "value": 15, "unit": "days", "percentile": 86, "active": False},
    {"zone": "UA_control", "period_start": p0, "period_end": p1, "type": "heavy_rain", "value": 21, "unit": "mm/day", "percentile": 95, "active": True},
    {"zone": "AU_main", "period_start": p0, "period_end": p1, "type": "heat30", "value": 4, "unit": "days", "percentile": 91, "active": True},
    {"zone": "AU_main", "period_start": p0, "period_end": p1, "type": "heat35", "value": 1, "unit": "days", "percentile": 88, "active": False},
    {"zone": "AU_control", "period_start": p0, "period_end": p1, "type": "dry_spell", "value": 12, "unit": "days", "percentile": 90, "active": True},
])

# --- tips rules (team reviews): signal -> tip, priority (lower = shown first)
tips = pd.DataFrame([
    ("drought_red", "irrigate_earlier", 1), ("drought_red", "check_insurance", 2), ("drought_red", "tolerant_varieties", 3),
    ("drought_yellow", "irrigate_earlier", 2), ("drought_yellow", "tolerant_varieties", 4),
    ("dry_soil", "delay_fertiliser", 2), ("dry_spell", "keep_cover", 1), ("dry_spell", "no_burning", 3),
    ("heat30", "water_cool_hours", 1), ("heat35", "water_cool_hours", 1), ("frost", "frost_protect", 1),
    ("heavy_rain", "check_drainage", 1), ("el_nino_au", "plan_dry_season", 2), ("normal", "keep_monitoring", 9),
], columns=["signal", "tip", "priority"])

events = pd.DataFrame([
    ("UA", "2022-02-24", None, "war", "Повномасштабне вторгнення", "Full-scale invasion"),
    ("UA", "2023-06-06", None, "dam", "Підрив Каховської ГЕС", "Kakhovka dam destroyed"),
    ("AU", "2006-06-01", "2007-12-31", "drought", "Посуха 2006–07", "2006–07 drought"),
    ("AU", "2018-01-01", "2019-12-31", "drought", "Посуха 2018–19", "2018–19 drought"),
    ("AU", "2022-02-01", "2022-11-30", "flood", "Повені 2022", "2022 floods"),
    ("ALL", "2015-05-01", "2016-04-30", "el_nino", "Сильне Ель-Ніньйо", "Strong El Niño"),
    ("ALL", "2023-06-01", "2024-04-30", "el_nino", "Ель-Ніньйо", "El Niño"),
    ("ALL", "2026-06-01", None, "el_nino", "Ель-Ніньйо 2026", "El Niño 2026"),
], columns=["country", "start", "end", "type", "label_uk", "label_en"])

data_dates = pd.DataFrame([
    ("precip", "NASA GPM IMERG Late (daily)", "2026-11-13", "8-day"),
    ("temp", "NASA MERRA-2 (daily)", "2026-11-12", "8-day"),
    ("soil_moisture", "NASA GLDAS Noah 2.1", "2026-10-31", "monthly"),
    ("ndvi", "NASA MODIS MOD13A3", "2026-10-31", "monthly"),
    ("grace_tws", "NASA GRACE-FO (JPL mascons)", "2026-08-31", "monthly"),
    ("oni", "NOAA CPC ONI", "2026-10-31", "monthly"),
], columns=["variable", "product", "last_date", "cadence"])

sources = pd.DataFrame([
    ("ndvi", "MODIS MOD13A3 v061", "NASA LP DAAC", "https://lpdaac.usgs.gov/products/mod13a3v061/"),
    ("precip", "GPM IMERG v07", "NASA GES DISC", "https://gpm.nasa.gov/data/imerg"),
    ("temp", "MERRA-2", "NASA GMAO", "https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/"),
    ("vpd", "MERRA-2 (from temperature and humidity)", "NASA GMAO", "https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/"),
    ("soil_moisture", "GLDAS Noah 2.1", "NASA GES DISC", "https://ldas.gsfc.nasa.gov/gldas"),
    ("evap", "GLDAS Noah 2.1", "NASA GES DISC", "https://ldas.gsfc.nasa.gov/gldas"),
    ("grace_tws", "GRACE / GRACE-FO mascons", "NASA JPL", "https://grace.jpl.nasa.gov/"),
    ("oni", "Oceanic Niño Index", "NOAA CPC", "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php"),
], columns=["variable", "product", "provider", "url"])

zones = pd.DataFrame([{"zone": z, "country": c, "zone_type": t, "name_uk": nu, "name_en": ne, "lat": la, "lon": lo,
                       "west": round(lo - h, 2), "south": round(la - h, 2), "east": round(lo + h, 2), "north": round(la + h, 2)}
                      for z, c, t, nu, ne, la, lo, h in ZONES])

ua_after = eva[eva["zone"].isin(["UA_main", "UA_second"]) & (eva["date"] >= "2023-06-01") & eva["date"].dt.month.isin(GROW["UA"])]
au_hit = eva[(eva["zone"] == "AU_main") & eva["date"].between("2018-07-01", "2019-12-31") & eva["date"].dt.month.isin(GROW["AU"])]
summary = pd.DataFrame([
    ("UA", "water_loss_effect_pct", round(ua_after["gap_pct"].mean(), 1), "%"),
    ("AU", "water_loss_effect_pct", round(au_hit["gap_pct"].mean(), 1), "%"),
    ("UA", "hit_depth_pct", round(ua_after["gap_pct"].min(), 1), "%"),
    ("AU", "hit_depth_pct", round(au_hit["gap_pct"].min(), 1), "%"),
    ("UA", "recovery_months", None, "months"), ("AU", "recovery_months", 13, "months"),
    ("UA", "chain_lag_months", 3, "months"), ("AU", "chain_lag_months", 2, "months"),
], columns=["country", "metric", "value", "unit"])

OUT = {
    "data/processed/all_series.parquet": series, "data/zones.csv": zones, "data/events.csv": events,
    "data/data_dates.csv": data_dates, "data/sources.csv": sources, "data/tips_rules.csv": tips,
    "results/trends.csv": trends, "results/lags.csv": lags, "results/expected_vs_actual.parquet": eva,
    "results/forecast.parquet": forecast, "results/model_skill.csv": skill, "results/feature_importance.csv": importance,
    "results/alerts.csv": alerts, "results/summary.csv": summary,
}
for rel, df in OUT.items():
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p, index=False) if rel.endswith(".parquet") else df.to_csv(p, index=False)
    print(f"wrote {rel:40s} {len(df):6d} rows")
