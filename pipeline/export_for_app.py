"""Turns the real NASA data (pipeline/feature_csvs) and the model team's results (pipeline/model_outputs)
into the files the app reads (data/ and results/, formats in CONTRACTS.md). Replaces the demo data.

    python pipeline/run_models.py      # 1. model team's notebook  -> pipeline/model_outputs/
    python pipeline/export_for_app.py  # 2. this script            -> data/, results/

Where a number comes from:
  * forecasts, drought light, trends, chain links, irrigation/dam effect -> the model team's outputs, copied as they are
  * three things the app needs that the notebook does not save are recomputed here with the notebook's own model
    settings (same features, hyper-parameters, seeds, splits):
      - per-zone accuracy on the 2022-2025 test years (the notebook reports it pooled over zones)
      - "expected from weather" for 2003-2021 (the notebook saves it for 2022-2025 only); every value is
        out-of-sample: 2018-2021 from the notebook's own validation fit, 2003-2017 by leaving 3-year blocks out
      - which weather factor the 1-month forecast relies on most (grouped permutation importance on the test years)
    The script checks that it reproduces the notebook's pooled numbers and its 2022-2025 expected values.
"""
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression, RidgeCV
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
FC = ROOT / "pipeline" / "feature_csvs"
MO = ROOT / "pipeline" / "model_outputs"
BASE = (2003, 2021)  # anomaly baseline, same as the datasets
SEED = 0


def csv(name, **kw):
    return pd.read_csv(FC / f"{name}.csv", **kw)


# ----------------------------------------------------------------------------- model settings (copied from notebook)
REG = ["ridge", "hgb", "et"]
EXC = ["zone", "country", "zone_type", "date", "split", "post_war", "post_dam"]


def make_reg(name):
    if name == "ridge":
        return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), RidgeCV(alphas=np.logspace(1, 3.5, 15)))
    if name == "hgb":
        return HistGradientBoostingRegressor(max_depth=3, learning_rate=0.04, max_iter=150, min_samples_leaf=25,
                                             l2_regularization=2.0, random_state=SEED)
    if name == "et":
        return make_pipeline(SimpleImputer(strategy="median"),
                             ExtraTreesRegressor(300, min_samples_leaf=8, max_features=0.5, n_jobs=-1, random_state=SEED))


def make_clf(name):
    if name == "logreg":
        return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                             LogisticRegression(C=.2, class_weight="balanced", max_iter=2000))
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=.05, max_iter=120, min_samples_leaf=20,
                                          l2_regularization=2.0, class_weight="balanced", random_state=SEED)


class Model:
    """One of the notebook's regressors, or 'ensemble' (mean of the three) / 'lin_1feature'."""

    def __init__(self, name, lin_col=None):
        self.name, self.lin_col = name, lin_col

    def fit(self, X, y):
        if self.name == "lin_1feature":
            self.m = make_pipeline(SimpleImputer(strategy="median"), LinearRegression()).fit(X[[self.lin_col]], y)
        else:
            names = REG if self.name == "ensemble" else [self.name]
            self.ms = [make_reg(n).fit(X, y) for n in names]
        return self

    def predict(self, X):
        if self.name == "lin_1feature":
            return self.m.predict(X[[self.lin_col]])
        return np.mean([m.predict(X) for m in self.ms], axis=0)


def months_add(s, h):
    return (s.dt.to_period("M") + h).dt.to_timestamp()


def z_to_cls(z):
    return np.where(z < -1, 0, np.where(z < -.5, 1, 2))


def check(label, ours, theirs, tol=1e-6):
    d = float(np.nanmax(np.abs(np.asarray(ours, float) - np.asarray(theirs, float))))
    status = "ok" if d <= tol else "MISMATCH"
    print(f"  check {label:55s} max diff {d:.2e}  {status}")
    if d > tol:
        raise SystemExit(f"Reproduction check failed: {label}")


# ----------------------------------------------------------------------------- zones, units, sources
ZONES = [
    # zone, country, type, name_uk, name_en, west, south, east, north
    ("UA_main", "UA", "irrigated", "Каховський зрошувальний масив", "Kakhovka irrigation area", 33.3, 46.2, 35.3, 47.0),
    ("UA_second", "UA", "irrigated", "Південь Дніпропетровщини", "Southern Dnipropetrovsk", 33.5, 47.4, 34.8, 47.9),
    ("UA_control", "UA", "control", "Північ Миколаївщини, без зрошення", "North Mykolaiv, rainfed", 31.0, 47.0, 32.5, 47.8),
    ("AU_main", "AU", "irrigated", "Зрошувальні райони Маррамбіджі", "Murrumbidgee irrigation areas", 145.0, -35.3, 146.8, -34.0),
    ("AU_control", "AU", "control", "Темора / Вест-Вайалонг, без зрошення", "Temora / West Wyalong, rainfed", 147.0, -34.3, 147.8, -33.7),
]
ZONE_COUNTRY = {z[0]: z[1] for z in ZONES}
ZONE_TYPE = {z[0]: z[2] for z in ZONES}

SRC = {
    "ndvi": "NASA MODIS MOD13C2 v061",
    "gpm_m": "NASA GPM IMERG V07 monthly (GPM_3IMERGM)",
    "gldas_p": "NASA GLDAS Noah 2.1 rainfall (IMERG monthly not yet released)",
    "imerg_d": "NASA GPM IMERG V07 daily (GPM_3IMERGDF / DL), summed",
    "gldas": "NASA GLDAS Noah 2.1 (GLDAS_NOAH025_M)",
    "merra": "NASA MERRA-2 (M2TMNXSLV)",
    "merra_d": "NASA MERRA-2 daily (M2SDNXSLV), averaged",
    "daily": "NASA GPM IMERG daily + MERRA-2 daily",
    "nino": "NOAA PSL Niño-3.4 SST anomaly",
}


def zscore(df, col):
    """Anomaly vs the 2003-2021 mean and SD of the same zone and calendar month."""
    m = df["date"].dt.month
    base = df[df["date"].dt.year.between(*BASE)]
    g = base.groupby(["zone", base["date"].dt.month])[col]
    mu = g.mean().reindex(pd.MultiIndex.from_arrays([df["zone"], m])).values
    sd = g.std().reindex(pd.MultiIndex.from_arrays([df["zone"], m])).values
    return (df[col].values - mu) / sd, mu, sd


# ----------------------------------------------------------------------------- 1. monthly series
def build_series():
    raw = csv("12_monthly_raw_all_zones", parse_dates=["date"])
    daily = csv("13_daily_zone_2015_now", parse_dates=["day"])
    daily["date"] = daily["day"].dt.to_period("M").dt.to_timestamp()
    dim = daily.groupby(["zone", "date"]).agg(
        p_sum=("precip_mm_day", "sum"), p_n=("precip_mm_day", "count"),
        t_mean=("tmean_c", "mean"), t_n=("tmean_c", "count"),
        heat30=("hot_day_30", "sum"), frost=("frost_day", "sum"), heat35=("very_hot_day_35", "sum"), dry_max=("dry_spell_days", "max")).reset_index()
    dim["days"] = dim["date"].dt.days_in_month
    dim["p_ok"] = dim["p_n"] == dim["days"]
    dim["t_ok"] = dim["t_n"] == dim["days"]

    last_raw = raw["date"].max()
    extra = dim[(dim["date"] > last_raw) & dim["p_ok"]][["zone", "date"]]
    m = pd.concat([raw, extra.assign(country=extra.zone.map(ZONE_COUNTRY))], ignore_index=True)
    m = m.merge(dim, on=["zone", "date"], how="left").sort_values(["zone", "date"]).reset_index(drop=True)
    m["country"] = m["zone"].map(ZONE_COUNTRY)
    m["zone_type"] = m["zone"].map(ZONE_TYPE)
    days = m["date"].dt.days_in_month

    # rainfall: IMERG monthly; after it ends, IMERG daily sums (complete months) instead of GLDAS
    gpm = m["precip_source"].astype(str).str.upper().eq("GPM")
    use_daily = ~gpm & m["p_ok"].fillna(False).astype(bool)
    p_mm = np.where(gpm, m["precip_mm"], np.where(use_daily, m["p_sum"], m["precip_mm"]))
    p_src = np.where(gpm, SRC["gpm_m"], np.where(use_daily, SRC["imerg_d"], SRC["gldas_p"]))
    m["precip"] = p_mm / days
    # temperature: MERRA-2 monthly; after it ends, MERRA-2 daily means (complete months). Both agree to 0.01 °C.
    t_ok = m["t_ok"].fillna(False).astype(bool)
    m["temp"] = np.where(m["t2m_merra2_c"].notna(), m["t2m_merra2_c"], np.where(t_ok, m["t_mean"], np.nan))
    t_src = np.where(m["t2m_merra2_c"].notna(), SRC["merra"], SRC["merra_d"])
    m["soil_moisture"] = m["sm_root_mm"]
    m["evap"] = m["et_mm"] / days
    m["vpd"] = m["vpd_kpa"]
    m["heat_days_30"] = np.where(t_ok, m["heat30"], np.nan)
    m["frost_days"] = np.where(t_ok, m["frost"], np.nan)
    m["heat_days_35"] = np.where(t_ok, m["heat35"], np.nan)
    m["dry_spell_max"] = np.where(m["p_ok"].fillna(False).astype(bool), m["dry_max"], np.nan)
    nino = raw.drop_duplicates("date").set_index("date")["nino34_anom_c"]
    m["oni"] = m["date"].map(nino)

    for v in ["ndvi", "precip", "soil_moisture", "vpd", "temp"]:
        m[f"{v}_z"], mu, _ = zscore(m, v)
        if v == "ndvi":
            m["ndvi_pct_normal"] = (m["ndvi"] / mu - 1) * 100

    spec = {  # variable: (unit, source)
        "ndvi": ("index", SRC["ndvi"]), "ndvi_z": ("z", SRC["ndvi"]), "ndvi_pct_normal": ("%", SRC["ndvi"]),
        "precip": ("mm/day", p_src), "precip_z": ("z", p_src),
        "soil_moisture": ("kg/m2", SRC["gldas"]), "soil_moisture_z": ("z", SRC["gldas"]),
        "evap": ("mm/day", SRC["gldas"]), "vpd": ("kPa", SRC["gldas"]), "vpd_z": ("z", SRC["gldas"]),
        "temp": ("degC", t_src), "temp_z": ("z", t_src),
        "heat_days_30": ("days", SRC["merra_d"]), "frost_days": ("days", SRC["merra_d"]), "heat_days_35": ("days", SRC["merra_d"]), "dry_spell_max": ("days", SRC["imerg_d"]), "oni": ("degC", SRC["nino"]),
    }
    rows = []
    for v, (unit, src) in spec.items():
        d = pd.DataFrame({"zone": m["zone"], "country": m["country"], "zone_type": m["zone_type"], "variable": v,
                          "date": m["date"], "value": m[v].astype(float).round(4), "unit": unit, "source": src})
        rows.append(d.dropna(subset=["value"]))
    series = pd.concat(rows, ignore_index=True)

    # the z-scores must match the ones the models were trained on
    d4 = csv("04_expected_vs_actual_human_effect", parse_dates=["date"])
    chk = m[["zone", "date", "ndvi_z"]].merge(d4[["zone", "date", "target_ndvi_z_t0"]], on=["zone", "date"]).dropna()
    check("ndvi_z equals the models' target_ndvi_z_t0", chk["ndvi_z"], chk["target_ndvi_z_t0"], 1e-6)
    return series, m


# ----------------------------------------------------------------------------- 2. forecasts and per-zone skill
def forecasts_and_skill():
    pred = pd.read_csv(MO / "predictions.csv", parse_dates=["origin", "target_date"])
    metrics = pd.read_csv(MO / "metrics.csv")
    p01 = pred[pred["set"] == "01_ndvi"].copy()
    p01["horizon"] = p01["horizon"].astype(int)  # the column also holds "next 8d" / "year 2025" for other sets
    p02 = pred[pred["set"] == "02_drought"].copy()
    p02["h"] = p02["horizon"].astype(int)
    lab = {"red_drought": "red", "yellow_risk": "yellow", "green_normal": "green"}

    fc = pd.DataFrame({
        "zone": p01["zone"], "issue_date": p01["origin"], "target_date": p01["target_date"],
        "lead_months": p01["horizon"].astype(int), "predicted": p01["value"].round(3),
        "low": p01["p10"].round(3), "high": p01["p90"].round(3),
        "beats_baseline": p01["valid_skill_vs_zero"] > 0, "model": p01["model"]})
    cls = p02.set_index(["zone", "h"])
    fc["light_model"] = [lab.get(cls.loc[(z, h), "label"]) for z, h in zip(fc.zone, fc.lead_months)]
    for c in ("prob_red", "prob_yellow", "prob_green"):
        fc[c] = [round(float(cls.loc[(z, h), c]), 3) for z, h in zip(fc.zone, fc.lead_months)]
    fc["light_model_name"] = [cls.loc[(z, h), "model"] for z, h in zip(fc.zone, fc.lead_months)]

    # per-zone test skill, refitting exactly as the notebook's run_reg does (train+valid -> test 2022-2025)
    d1 = csv("01_ndvi_forecast", parse_dates=["date"])
    d2 = csv("02_drought_traffic_light", parse_dates=["date"])
    F1 = [c for c in d1.columns if c not in EXC and not c.startswith("target")]
    F2 = [c for c in d2.columns if c not in EXC and not c.startswith("target")]
    ts = d1.loc[d1.split == "test", "date"].min()
    rows = []
    for h in (1, 3, 6):
        tgt = f"target_ndvi_z_t+{h}"
        best = p01.loc[p01.horizon == h, "model"].iloc[0]
        ok = d1[tgt].notna()
        tv = d1[d1.split.isin(["train", "valid"]) & ok & (months_add(d1.date, h) < ts)]
        te = d1[(d1.split == "test") & ok]
        mdl = Model(best, "ndvi_z_lag1").fit(tv[F1], tv[tgt])
        p = mdl.predict(te[F1])
        res = te[tgt].values - p
        q10, q90 = np.quantile(res, [.1, .9])
        team = metrics[(metrics.set == "01_ndvi") & (metrics.horizon == h) & (metrics.model == best) & (metrics.split == "test")]
        check(f"01 t+{h} pooled test RMSE ({best})", [np.sqrt(np.mean(res ** 2))], team["RMSE"].values, 1e-9)
        team_q = p01[p01.horizon == h].iloc[0]
        check(f"01 t+{h} 80% band", [q10, q90], [team_q.p10 - team_q.value, team_q.p90 - team_q.value], 1e-9)

        # drought light on test: the notebook's chosen method for this horizon
        ctgt = f"target_drought_class_t+{h}"
        cmap = {"red_drought": 0, "yellow_risk": 1, "green_normal": 2}
        y2 = d2[ctgt].map(cmap)
        method = p02.loc[p02.h == h, "model"].iloc[0]
        te2 = d2[(d2.split == "test") & y2.notna()]
        if method.startswith("reg01+thresholds"):
            pz = pd.Series(p, index=te.index).reindex(te2.index).values
            cl = z_to_cls(pz)
        else:
            tv2 = d2[d2.split.isin(["train", "valid"]) & y2.notna() & (months_add(d2.date, h) < ts)]
            cl = make_clf(method).fit(tv2[F2], y2[tv2.index]).predict_proba(te2[F2]).argmax(1)
        t2 = te2.assign(pred=cl, true=y2[te2.index].values)

        tz = te.assign(pred=p, res=res)
        for z, g in tz.groupby("zone"):
            g2 = t2[t2.zone == z]
            red = g2[g2.true == 0]
            rows.append({
                "zone": z, "country": ZONE_COUNTRY[z], "horizon": h, "model": best,
                "rmse": round(float(np.sqrt(np.mean(g.res ** 2))), 3),
                "rmse_persistence": round(float(np.sqrt(np.mean((g[tgt] - g.ndvi_z_lag1.fillna(0)) ** 2))), 3),
                "rmse_climatology": round(float(np.sqrt(np.mean(g[tgt] ** 2))), 3),
                "class_accuracy": round(float((g2.pred == g2.true).mean()), 3),
                "drought_hit_rate": round(float((red.pred == 0).mean()), 3) if len(red) else None,
                "coverage80": round(float(((g.res >= q10) & (g.res <= q90)).mean()), 3),
                "r2": round(float(1 - np.sum(g.res ** 2) / np.sum((g[tgt] - g[tgt].mean()) ** 2)), 3),
                "n_test": len(g), "light_method": method,
            })
    return fc, pd.DataFrame(rows)


# ----------------------------------------------------------------------------- 3. expected vs actual (whole record)
def expected_vs_actual(m):
    d4 = csv("04_expected_vs_actual_human_effect", parse_dates=["date"])
    T = "target_ndvi_z_t0"
    F = [c for c in d4.columns if c not in EXC + [T]]
    pre = d4[(d4.split == "train_pre2022") & d4[T].notna()]
    fit_a, val_a = pre[pre.date < "2018-01-01"], pre[pre.date >= "2018-01-01"]
    # model choice exactly as the notebook: lowest validation MSE among REG + ensemble
    pv = {n: Model(n).fit(fit_a[F], fit_a[T]).predict(val_a[F]) for n in REG}
    pv["ensemble"] = np.mean([pv[n] for n in REG], axis=0)
    best = min(REG + ["ensemble"], key=lambda n: mean_squared_error(val_a[T], pv[n]))
    print(f"  expected-from-weather model: {best}")

    out = d4[["zone", "date", T]].copy()
    out["expected_z"] = np.nan
    pre_all = d4[d4.split == "train_pre2022"]
    # 2022-2025: fit on all 2003-2021 (as the notebook)
    app = d4[d4.split == "apply_2022_2025"]
    out.loc[app.index, "expected_z"] = Model(best).fit(pre[F], pre[T]).predict(app[F])
    # 2018-2021: the notebook's validation fit on 2003-2017
    va_all = pre_all[pre_all.date >= "2018-01-01"]
    out.loc[va_all.index, "expected_z"] = Model(best).fit(fit_a[F], fit_a[T]).predict(va_all[F])
    # 2003-2017: leave each 3-year block out
    for y0 in range(2003, 2018, 3):
        blk = pre_all[pre_all.date.dt.year.between(y0, min(y0 + 2, 2017))]
        trn = pre[~pre.date.dt.year.between(y0, y0 + 2)]
        out.loc[blk.index, "expected_z"] = Model(best).fit(trn[F], trn[T]).predict(blk[F])

    team = pd.read_csv(MO / "human_effect_residuals.csv", parse_dates=["date"])
    chk = out.merge(team, on=["zone", "date"])
    check("expected 2022-2025 equals notebook's human_effect_residuals", chk["expected_z"], chk["expected"], 1e-9)

    # z -> NDVI with each zone/month's 2003-2021 mean and SD
    _, mu, sd = zscore(m, "ndvi")
    key = m.set_index(["zone", "date"])
    mm = pd.DataFrame({"mu": mu, "sd": sd}, index=key.index)
    out = out.join(mm, on=["zone", "date"]).join(key["ndvi"], on=["zone", "date"])
    res = (out[T] - out["expected_z"])[out.date < "2022-01-01"].dropna()
    q10, q90 = np.quantile(res, [.1, .9])
    ev = pd.DataFrame({
        "zone": out.zone, "date": out.date, "actual": out.ndvi.round(4),
        "expected": (out.mu + out.expected_z * out.sd).round(4),
        "expected_low": (out.mu + (out.expected_z + q10) * out.sd).round(4),
        "expected_high": (out.mu + (out.expected_z + q90) * out.sd).round(4),
        "actual_z": out[T].round(3), "expected_z": out.expected_z.round(3),
    })
    ev["gap"] = (ev.actual - ev.expected).round(4)
    ev["gap_pct"] = (ev.gap / ev.expected * 100).round(2)
    ev["out_of_sample"] = np.where(out.date >= "2022-01-01", "test_2022_2025",
                                   np.where(out.date >= "2018-01-01", "validation_2018_2021", "blocked_cv_2003_2017"))
    return ev.dropna(subset=["expected"]).sort_values(["zone", "date"]).reset_index(drop=True)


# ----------------------------------------------------------------------------- 4. what the 1-month forecast relies on
GROUPS = {
    "precip": ["spi3_approx", "spi6_approx"], "soil_moisture": ["sm_root_mm_anom", "sm_root_anom_lag1"],
    "vpd": ["vpd_kpa_anom", "vpd_anom_3m"], "temp": ["tair_c_anom"], "evap": ["et_mm_anom"], "runoff": ["runoff_anom_3m"],
    "oni": ["enso_lag0", "enso_lag3"], "nao": ["nao_lag0"], "sam": ["sam_lag0"],
    "ghg": ["co2_growth_12m", "ch4_growth_12m", "water_vapour_kg_m2_anom"], "ozone": ["ozone_du_anom"],
}


def importance():
    pred = pd.read_csv(MO / "predictions.csv")
    best = pred[(pred.set == "01_ndvi") & (pred.horizon.astype(str) == "1")]["model"].iloc[0]
    d1 = csv("01_ndvi_forecast", parse_dates=["date"])
    F = [c for c in d1.columns if c not in EXC and not c.startswith("target")]
    tgt = "target_ndvi_z_t+1"
    ts = d1.loc[d1.split == "test", "date"].min()
    ok = d1[tgt].notna()
    tv = d1[d1.split.isin(["train", "valid"]) & ok & (months_add(d1.date, 1) < ts)]
    te = d1[(d1.split == "test") & ok]
    mdl = Model(best).fit(tv[F], tv[tgt])
    rng = np.random.default_rng(SEED)
    rows = []
    for country, g in te.groupby(te.zone.str[:2]):
        base = mean_absolute_error(g[tgt], mdl.predict(g[F]))
        imp = {}
        for name, cols in GROUPS.items():
            inc = []
            for _ in range(30):
                X = g[F].copy()
                perm = rng.permutation(len(X))
                for c in cols:
                    X[c] = X[c].values[perm]
                inc.append(mean_absolute_error(g[tgt], mdl.predict(X)) - base)
            imp[name] = max(0.0, float(np.mean(inc)))
        tot = sum(imp.values()) or 1.0
        ranked = sorted(imp.items(), key=lambda kv: -kv[1])
        rows += [{"country": country, "feature": k, "importance": round(v / tot, 3), "rank": i + 1,
                  "mae_increase": round(v, 4), "method": f"grouped permutation, 1-month forecast ({best}), test 2022-2025"}
                 for i, (k, v) in enumerate(ranked)]
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- 5. trends and chain (model team, renamed)
TREND_VARS = {"ndvi": ("ndvi", "index"), "precip_mm": ("precip", "mm/month"), "sm_root_mm": ("soil_moisture", "kg/m2"),
              "et_mm": ("evap", "mm/month"), "tair_c": ("temp", "degC"), "vpd_kpa": ("vpd", "kPa"), "rh_pct": ("rh", "%"),
              "runoff_mm": ("runoff", "mm/month"), "ozone_du": ("ozone", "DU"), "water_vapour_kg_m2": ("water_vapour", "kg/m2")}


def years_to_emergence(y):
    """Weatherhead et al. (1998): years of record needed to detect the current trend (same as analysis.py)."""
    y = pd.Series(y).dropna()
    t = np.arange(len(y))
    slope, icp = np.polyfit(t, y.values, 1)
    r = y.values - (slope * t + icp)
    sigma = r.std(ddof=1)
    phi = pd.Series(r).autocorr(1)
    phi = 0 if np.isnan(phi) else max(min(phi, 0.95), -0.95)
    return np.inf if slope == 0 else float((3.3 * sigma / abs(slope) * np.sqrt((1 + phi) / (1 - phi))) ** (2 / 3))


def trends():
    t = pd.read_csv(MO / "trends_06.csv")
    yearly = csv("06_trends_growing_season_yearly")
    out = []
    for r in t.itertuples():
        var, unit = TREND_VARS[r.variable]
        sig = r.p_fdr < 0.05
        yrs = None
        if not sig:
            y = yearly[yearly.zone == r.zone].sort_values("year")[r.variable]
            need = years_to_emergence(y) - len(y.dropna())
            yrs = int(round(need)) if np.isfinite(need) and 0 < need <= 50 else None
        out.append({"zone": r.zone, "variable": var, "season": "growing", "slope_per_decade": round(r.sen_per_decade, 4),
                    "ci_low": round(r.sen_ci_lo * 10, 4), "ci_high": round(r.sen_ci_hi * 10, 4),
                    "p_value": round(r.p_use, 5), "p_value_fdr": round(r.p_fdr, 5), "significant": bool(sig),
                    # model team's rule: confirmed after FDR; possible = p < 0.10 before correction
                    "badge": "confirmed" if sig else ("possible" if r.p_use < 0.10 else "none"),
                    "years_to_significance": yrs, "unit": unit, "label_team": r.badge, "n_years": r.n_years})
    return pd.DataFrame(out)


CHAIN_VARS = {"spi3_approx": "precip", "sm_root_mm_anom": "soil_moisture", "et_mm_anom": "evap", "vpd_kpa_anom": "vpd",
              "tair_c_anom": "temp", "ndvi_z": "ndvi", "enso_lag0": "oni"}
# links drawn in the app's diagram (others cross boxes; all links stay in pipeline/model_outputs)
DIAGRAM = [("oni", "temp"), ("oni", "precip"), ("precip", "soil_moisture"), ("precip", "evap"), ("temp", "soil_moisture"),
           ("vpd", "soil_moisture"), ("soil_moisture", "ndvi"), ("evap", "ndvi"), ("vpd", "ndvi")]


def chain():
    e = pd.read_csv(MO / "chain_graph_edges_07.csv")
    best = pd.read_csv(MO / "chain_links_07_best.csv")
    e["country"] = e["country"].map({"Україна": "UA", "Австралія": "AU"})
    e["from_var"], e["to_var"] = e["cause"].map(CHAIN_VARS), e["effect"].map(CHAIN_VARS)
    rows = []
    for c in ("UA", "AU"):
        for a, b in DIAGRAM:
            hit = e[(e.country == c) & (e.from_var == a) & (e.to_var == b)]
            if len(hit):
                h = hit.iloc[0]
                pz = best[(best.cause == h.cause) & (best.effect == h.effect) & best.zone.str.startswith(c)]
                rows.append({"country": c, "from_var": a, "to_var": b, "lag_months": int(h.lag_months), "corr": h.r,
                             "p_value_fdr": float(pz.p_fdr.max()) if len(pz) else None, "significant": True})
            else:  # tested by the model team, not significant after correction
                rows.append({"country": c, "from_var": a, "to_var": b, "lag_months": 0, "corr": None,
                             "p_value_fdr": None, "significant": False})
    lags = pd.DataFrame(rows)
    lag = {c: int(e[(e.country == c) & (e.cause == "spi3_approx") & (e.effect == "ndvi_z")].lag_months.iloc[0]) for c in ("UA", "AU")}
    return lags, lag


# ----------------------------------------------------------------------------- 6. summary (Ukraine vs Australia)
def summary(ev, chain_lag):
    ev = ev.copy()
    ev["m"] = ev.date.dt.month
    season = {"UA": [4, 5, 6, 7, 8], "AU": [6, 7, 8, 9, 10]}

    def diff(main, ctrl, c):
        a = ev[ev.zone == main].set_index("date")
        b = ev[ev.zone == ctrl].set_index("date")
        d = (a.gap_pct - b.gap_pct).dropna()
        return d[d.index.month.isin(season[c])]

    ua = diff("UA_main", "UA_control", "UA")
    war, dam = ua["2022-03-01":"2023-06-30"], ua["2023-07-01":]
    au = diff("AU_main", "AU_control", "AU")
    base_au = au[:"2017-12-31"]
    hit = au["2018-01-01":"2019-12-31"]
    after = au["2020-01-01":]
    rec = after[after >= base_au.mean()]
    rec_months = None
    if len(rec):
        first = rec.index[0]
        rec_months = (first.year - 2019) * 12 + first.month - 12
    rows = [
        ("UA", "water_loss_effect_pct", round(dam.mean() - war.mean(), 1), "%"),
        ("AU", "water_loss_effect_pct", round(hit.mean() - base_au.mean(), 1), "%"),
        ("UA", "hit_depth_pct", round((dam - war.mean()).min(), 1), "%"),
        ("AU", "hit_depth_pct", round((hit - base_au.mean()).min(), 1), "%"),
        ("UA", "recovery_months", None, "months"),
        ("AU", "recovery_months", rec_months, "months"),
        ("UA", "chain_lag_months", chain_lag["UA"], "months"),
        ("AU", "chain_lag_months", chain_lag["AU"], "months"),
    ]
    s = pd.DataFrame(rows, columns=["country", "metric", "value", "unit"])
    s["definition"] = [
        "Kakhovka dam: growing-season (Apr-Aug) gap to weather-only expectation, UA_main minus rainfed UA_control, after Jul 2023 minus war period Mar 2022-Jun 2023",
        "2018-19 drought: growing-season (Jun-Oct) gap, AU_main minus rainfed AU_control, 2018-19 minus 2003-2017 average",
        "Worst single growing-season month of the same difference after Jul 2023",
        "Worst single growing-season month of the same difference in 2018-19",
        "Not recovered: the reservoir has not been restored (data to Dec 2025)",
        "Months after Dec 2019 until the AU_main minus AU_control gap first returned to its 2003-2017 average",
        "Rain (3-month SPI) to field greenness, model team chain analysis",
        "Rain (3-month SPI) to field greenness, model team chain analysis",
    ]
    return s


# ----------------------------------------------------------------------------- 7. 8-day alerts
def alerts():
    p8 = csv("08_alerts_8day", parse_dates=["period_start"])
    daily = csv("13_daily_zone_2015_now", parse_dates=["day"])
    # complete 8-day periods only (the last period of a year is shorter by design; a period still in progress is skipped)
    year_end = p8.period_of_year == p8.period_of_year.max()
    full = p8[(p8.rain_days_obs == p8.period_days) & ((p8.period_days == 8) | year_end)]
    last = full.groupby("zone").period_start.max().min()  # latest complete period in every zone
    rows = []
    for z in sorted(p8.zone.unique()):
        hist = p8[(p8.zone == z) & p8.period_start.dt.year.between(2015, 2024)]
        cur = p8[(p8.zone == z) & (p8.period_start == last)].iloc[0]
        end = last + pd.Timedelta(days=int(cur.period_days) - 1)
        dz = daily[daily.zone == z]

        def win(start, n):
            return dz[(dz.day >= start) & (dz.day < start + pd.Timedelta(days=int(n)))]

        def stat(start, n):
            w = win(start, n)
            return float(w.dry_spell_days.max()), float(w.precip_mm_day.max())

        same = hist[hist.period_of_year == cur.period_of_year]
        past = np.array([stat(r.period_start, r.period_days) for r in same.itertuples()])
        spell, rain = stat(last, cur.period_days)
        pct_spell = round(100 * float(np.mean(past[:, 0] < spell)))
        pct_rain = round(100 * float(np.mean(past[:, 1] < rain)))
        common = {"zone": z, "period_start": last, "period_end": end}
        rows.append({**common, "type": "dry_spell", "value": int(spell), "unit": "days", "percentile": pct_spell,
                     "active": bool(pct_spell >= 90 and spell >= 7)})
        if rain >= 10:  # below 10 mm in a day "heavy rain" is not meaningful, so no row
            rows.append({**common, "type": "heavy_rain", "value": round(rain, 1), "unit": "mm/day", "percentile": pct_rain,
                         "active": bool(pct_rain >= 95)})
        if pd.notna(cur.tmax_mean_c) and cur.temp_days_obs == cur.period_days:
            for typ, col in (("heat30", "hot_days_30"), ("heat35", "very_hot_days_35"), ("frost", "frost_days")):
                v = float(cur[col])
                pct = round(100 * float(np.mean(same[col] < v)))
                rows.append({**common, "type": typ, "value": int(v), "unit": "days", "percentile": pct,
                             "active": bool(v > 0 and pct >= 90)})
    a = pd.DataFrame(rows)

    # model team's 8-day forecast: only dry_spell passed their reliability test
    pred = pd.read_csv(MO / "predictions.csv")
    ds = pred[(pred.set == "08_alerts") & (pred.target == "target_alert_dry_spell_next8d")]
    if len(ds) and bool(ds.reliable.iloc[0]):
        f = pd.DataFrame({"zone": ds.zone, "type": "dry_spell_next8d", "value": (ds.value * 100).round().astype(int),
                          "unit": "%", "percentile": None, "active": ds.label.astype(float) == 1.0})
        per = a.drop_duplicates("zone").set_index("zone")
        f["period_start"] = f.zone.map(per.period_start)
        f["period_end"] = f.zone.map(per.period_end)
        f["forecast_origin"] = ds.origin.values
        a = pd.concat([a, f], ignore_index=True)
    return a, last


# ----------------------------------------------------------------------------- 8. small reference tables
EVENTS = [
    ("AU", "2006-06-01", "2007-12-31", "drought", "Посуха 2006–07 (кінець «Тисячолітньої посухи»)", "2006–07 drought (end of the Millennium Drought)"),
    ("AU", "2010-09-01", "2011-03-31", "flood", "Повені Ла-Нінья 2010–11", "2010–11 La Niña floods"),
    ("AU", "2017-06-01", "2019-12-31", "drought", "Посуха 2017–19", "2017–19 drought"),
    ("AU", "2019-09-01", "2020-02-29", "fire", "Пожежі «Чорного літа»", "Black Summer bushfires"),
    ("AU", "2020-09-01", "2022-12-31", "la_nina", "Три роки Ла-Нінья (волого)", "Three La Niña years (wet)"),
    ("ALL", "2015-03-01", "2016-05-31", "el_nino", "Сильне Ель-Ніньйо 2015–16", "Strong El Niño 2015–16"),
    ("ALL", "2023-05-01", "2024-04-30", "el_nino", "Ель-Ніньйо 2023–24", "El Niño 2023–24"),
    ("UA", "2020-03-01", "2020-09-30", "drought", "Посуха 2020 на півдні", "2020 drought in the south"),
    ("UA", "2022-02-24", None, "war", "Повномасштабне вторгнення", "Full-scale invasion"),
    ("UA", "2023-06-06", None, "dam", "Підрив Каховської ГЕС", "Kakhovka dam destroyed"),
]
SOURCES = [
    ("ndvi", "MODIS MOD13C2 v061 (monthly, 0.05°)", "NASA LP DAAC", "https://lpdaac.usgs.gov/products/mod13c2v061/"),
    ("precip", "GPM IMERG V07 monthly (GPM_3IMERGM)", "NASA GES DISC", "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary"),
    ("precip", "GPM IMERG V07 daily Final / Late (GPM_3IMERGDF, GPM_3IMERGDL)", "NASA GES DISC", "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDF_07/summary"),
    ("soil_moisture", "GLDAS Noah 2.1 monthly (GLDAS_NOAH025_M), 0–40 cm", "NASA GES DISC", "https://disc.gsfc.nasa.gov/datasets/GLDAS_NOAH025_M_2.1/summary"),
    ("evap", "GLDAS Noah 2.1 monthly (GLDAS_NOAH025_M)", "NASA GES DISC", "https://disc.gsfc.nasa.gov/datasets/GLDAS_NOAH025_M_2.1/summary"),
    ("vpd", "GLDAS Noah 2.1 (from air temperature, humidity and pressure)", "NASA GES DISC", "https://disc.gsfc.nasa.gov/datasets/GLDAS_NOAH025_M_2.1/summary"),
    ("temp", "MERRA-2 monthly (M2TMNXSLV) and daily (M2SDNXSLV)", "NASA GMAO / GES DISC", "https://disc.gsfc.nasa.gov/datasets/M2TMNXSLV_5.12.4/summary"),
    ("heat_days_30", "MERRA-2 daily maximum temperature (M2SDNXSLV)", "NASA GMAO / GES DISC", "https://disc.gsfc.nasa.gov/datasets/M2SDNXSLV_5.12.4/summary"),
    ("dry_spell_max", "GPM IMERG V07 daily", "NASA GES DISC", "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDF_07/summary"),
    ("oni", "Niño-3.4 sea surface temperature anomaly", "NOAA PSL", "https://psl.noaa.gov/data/climateindices/list/"),
    ("ghg", "CO₂, CH₄, N₂O, SF₆ monthly", "NOAA GML", "https://gml.noaa.gov/ccgg/trends/"),
    ("yield", "Cereal yield (AG.YLD.CREL.KG)", "World Bank", "https://data.worldbank.org/indicator/AG.YLD.CREL.KG"),
]


def data_dates(series, last_rain_day):
    rows = []
    for v, product, cadence in [("ndvi", "NASA MODIS MOD13C2", "monthly"), ("soil_moisture", "NASA GLDAS Noah 2.1", "monthly"),
                                ("precip", "NASA GPM IMERG daily", "8-day"), ("temp", "NASA MERRA-2 daily", "monthly"),
                                ("vpd", "NASA GLDAS Noah 2.1", "monthly"), ("oni", "NOAA Niño-3.4", "monthly")]:
        last = series[series.variable == v].date.max()
        rows.append((v, product, (last + pd.offsets.MonthEnd(0)).date().isoformat(), cadence))
    rows[2] = ("precip", "NASA GPM IMERG daily", last_rain_day.date().isoformat(), "8-day")
    return pd.DataFrame(rows, columns=["variable", "product", "last_date", "cadence"])


# ----------------------------------------------------------------------------- main
def write(rel, df):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p, index=False) if rel.endswith(".parquet") else df.to_csv(p, index=False)
    print(f"  wrote {rel:40s} {len(df):6d} rows")


if __name__ == "__main__":
    print("series ..."); series, m = build_series()
    print("forecast + skill ..."); fc, skill = forecasts_and_skill()
    print("expected vs actual ..."); ev = expected_vs_actual(m)
    print("importance ..."); imp = importance()
    print("trends, chain, alerts ...")
    tr = trends()
    lags, chain_lag = chain()
    al, alert_last = alerts()
    summ = summary(ev, chain_lag)
    zones = pd.DataFrame([{"zone": z, "country": c, "zone_type": t, "name_uk": nu, "name_en": ne,
                           "lat": round((s + n) / 2, 3), "lon": round((w + e) / 2, 3), "west": w, "south": s, "east": e, "north": n}
                          for z, c, t, nu, ne, w, s, e, n in ZONES])
    tips = pd.read_csv(ROOT / "data" / "tips_rules.csv")
    extra = pd.DataFrame([("dry_spell_next8d", "keep_cover", 1), ("dry_spell_next8d", "water_cool_hours", 2)],
                         columns=["signal", "tip", "priority"])
    tips = pd.concat([tips[tips.signal != "dry_spell_next8d"], extra], ignore_index=True)

    print("writing ...")
    write("data/processed/all_series.parquet", series)
    write("data/zones.csv", zones)
    write("data/events.csv", pd.DataFrame(EVENTS, columns=["country", "start", "end", "type", "label_uk", "label_en"]))
    d13 = csv("13_daily_zone_2015_now", parse_dates=["day"])
    write("data/data_dates.csv", data_dates(series, d13.dropna(subset=["precip_mm_day"]).day.max()))
    write("data/sources.csv", pd.DataFrame(SOURCES, columns=["variable", "product", "provider", "url"]))
    write("data/tips_rules.csv", tips)
    write("results/trends.csv", tr)
    write("results/lags.csv", lags)
    write("results/expected_vs_actual.parquet", ev)
    write("results/forecast.parquet", fc)
    write("results/model_skill.csv", skill)
    write("results/feature_importance.csv", imp)
    write("results/alerts.csv", al)
    write("results/summary.csv", summ)
    print("done")
