"""Combines the result files into what each screen needs. Rules (thresholds, signals) live here only,
so the traffic light is identical everywhere. Returns codes, never sentences: all wording is in the
frontend translation files."""
import pandas as pd

from . import store

# Drought traffic light on field greenness z-score (forecast and "now"): one rule for the whole app
Z_YELLOW = -0.5
Z_RED = -1.0
STATE_BAND = 0.5          # |z| below this = "normal"
ENSO_THRESHOLD = 0.5      # ONI >= 0.5 El Nino, <= -0.5 La Nina


def light(z) -> str | None:
    if z is None or pd.isna(z):
        return None
    if z < Z_RED:
        return "red"
    if z < Z_YELLOW:
        return "yellow"
    return "green"


def state(z, invert=False) -> str:
    if z is None or pd.isna(z):
        return "unknown"
    if invert:
        z = -z
    return "low" if z < -STATE_BAND else ("high" if z > STATE_BAND else "normal")


def zone_info(zone: str) -> dict | None:
    z = store.load("zones")
    if z is None:
        return None
    row = z[z["zone"] == zone]
    return None if row.empty else store.records(row)[0]


def _latest(series: pd.DataFrame, zone: str, var: str):
    s = series[(series["zone"] == zone) & (series["variable"] == var)].dropna(subset=["value"]).sort_values("date")
    if s.empty:
        return None, None
    return s["date"].iloc[-1], float(s["value"].iloc[-1])


def now(zone: str) -> dict:
    info = zone_info(zone)
    country = info["country"] if info else None
    series = store.load("series")
    out = {"zone": info, "condition": None, "light_now": None, "history": [], "forecast": [], "skill": [],
           "alerts": [], "why": None, "tips": [], "data_dates": store.records(store.load("data_dates"))}
    if series is None or info is None:
        return out

    d, z = _latest(series, zone, "ndvi_z")
    _, pct = _latest(series, zone, "ndvi_pct_normal")
    if d is not None:
        out["condition"] = {"date": d.strftime("%Y-%m-%d"), "month": int(d.month), "ndvi_z": z, "pct_vs_normal": pct}
        out["light_now"] = light(z)
        h = series[(series["zone"] == zone) & (series["variable"] == "ndvi_z")].sort_values("date").tail(12)
        out["history"] = [{"date": r.date.strftime("%Y-%m-%d"), "value": r.value, "light": light(r.value)} for r in h.itertuples()]

    fc = store.load("forecast")
    if fc is not None:
        f = fc[fc["zone"] == zone]
        if not f.empty:
            f = f[f["issue_date"] == f["issue_date"].max()].sort_values("lead_months")
            # The drought light comes from the model team's drought-class model when the file has one
            # (for 3 and 6 months a classifier beat "regression + thresholds"); otherwise from the z thresholds.
            out["forecast"] = [dict(r, light=r.get("light_model") or light(r["predicted"])) for r in store.records(f)]

    skill = store.load("skill")
    if skill is not None:
        out["skill"] = store.records(skill[skill["zone"] == zone])

    alerts = store.load("alerts")
    if alerts is not None:
        a = alerts[alerts["zone"] == zone]
        if not a.empty:
            a = a[a["period_end"] == a["period_end"].max()]
        out["alerts"] = store.records(a)

    out["why"] = why(zone, country, series)
    out["tips"] = tips(out, country)
    return out


def why(zone: str, country: str, series: pd.DataFrame) -> dict:
    chain = []
    for var, invert in [("precip", False), ("soil_moisture", False), ("vpd", True), ("ndvi", False)]:
        _, z = _latest(series, zone, f"{var}_z")
        chain.append({"variable": var, "z": z, "state": state(z), "is_bad": state(z, invert) == "low"})
    _, oni = _latest(series, zone, "oni")
    enso = None if oni is None else ("el_nino" if oni >= ENSO_THRESHOLD else ("la_nina" if oni <= -ENSO_THRESHOLD else "neutral"))
    driver = None
    imp = store.load("importance")
    if imp is not None:
        top = imp[imp["country"] == country].sort_values("rank")
        driver = None if top.empty else top["feature"].iloc[0]
    return {"chain": chain, "driver": driver, "oni": oni, "enso": enso, "country": country}


def tips(now_out: dict, country: str) -> list:
    rules = store.load("tips_rules")
    if rules is None:
        return []
    signals = set()
    lights = [f["light"] for f in now_out["forecast"] if f.get("lead_months", 9) <= 3]
    if "red" in lights:
        signals.add("drought_red")
    elif "yellow" in lights:
        signals.add("drought_yellow")
    w = now_out.get("why") or {}
    soil = next((c for c in w.get("chain", []) if c["variable"] == "soil_moisture"), None)
    if soil and soil["z"] is not None and soil["z"] < Z_RED:
        signals.add("dry_soil")
    signals |= {a["type"] for a in now_out["alerts"] if a.get("active")}
    if country == "AU" and w.get("enso") == "el_nino":
        signals.add("el_nino_au")
    if not signals:
        signals.add("normal")
    r = rules[rules["signal"].isin(signals)].sort_values("priority").drop_duplicates("tip")
    return [{"tip": t.tip, "signal": t.signal} for t in r.head(3).itertuples()]


def compare() -> dict:
    out = {"summary": store.records(store.load("summary")), "drivers": [], "trends": []}
    imp = store.load("importance")
    if imp is not None:
        out["drivers"] = store.records(imp[imp["rank"] <= 3].sort_values(["country", "rank"]))
    tr, zones = store.load("trends"), store.load("zones")
    if tr is not None and zones is not None:
        main = {c: zones[(zones["country"] == c) & (zones["zone_type"] == "irrigated")]["zone"].iloc[0]
                for c in ("UA", "AU") if not zones[(zones["country"] == c) & (zones["zone_type"] == "irrigated")].empty}
        rows = []
        for var in ["temp", "heat_days_30", "precip", "soil_moisture", "dry_spell_max", "ndvi"]:
            rec = {"variable": var}
            for c, z in main.items():
                m = tr[(tr["zone"] == z) & (tr["variable"] == var)]
                if not m.empty:
                    rec[c] = store.records(m)[0]
            if "UA" in rec and "AU" in rec:
                su, sa = rec["UA"]["slope_per_decade"], rec["AU"]["slope_per_decade"]
                big = lambda r: abs(r["slope_per_decade"]) > 1e-9 and r.get("badge") != "none"
                if not (big(rec["UA"]) and big(rec["AU"])):
                    rec["relation"] = "unclear"
                else:
                    rec["relation"] = "shared" if su * sa > 0 else "opposite"
            rows.append(rec)
        out["trends"] = rows
    return out


def context(zone: str) -> dict:
    """Everything the assistant may use for one zone. The LLM must answer only from this."""
    info = zone_info(zone)
    n = now(zone)
    tr = store.load("trends")
    lags = store.load("lags")
    return {
        "zone": info,
        "now": {k: n[k] for k in ("condition", "light_now", "forecast", "alerts", "why", "tips")},
        "skill": n["skill"],
        "trends": store.records(tr[tr["zone"] == zone]) if tr is not None else [],
        "chain": store.records(lags[lags["country"] == info["country"]]) if lags is not None and info else [],
        "summary": store.records(store.load("summary")),
        "data_dates": n["data_dates"],
        "sources": store.records(store.load("sources")),
        "thresholds": {"z_yellow": Z_YELLOW, "z_red": Z_RED},
        "mock_data": store.is_mock(),
    }
