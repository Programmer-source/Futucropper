"""Step by step: a beginner's season timeline and year-by-year list, built ONLY from the /api/plan result.
Nothing is recomputed: every number is copied (or shown as a percentage) from planner.plan's output.
The only new data is TYPICAL_HARVEST (typical harvest months per crop, labelled "typical" in the UI).
The endpoint returns the ready LLM prompt ("messages"); the browser runs it with askAI, like the "AI analysis" card.
The prompt avoids "/" so it also survives URL-path routes."""
from . import advisor, planner

# typical harvest months per crop (new, labelled "typical")
TYPICAL_HARVEST = {
    "winter_wheat": [7], "spring_barley": [7, 8], "maize": [9, 10], "sunflower": [9], "soybean": [9],
    "wheat_au": [11, 12], "canola": [11], "barley_au": [11], "rice": [3, 4], "cotton": [4, 5],
}
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SYSTEM = ("You are a farm guide for beginners. Use only these numbers, with units. For each step write one short practical "
          "sentence. Then for each year write one remark: what to watch, and whether to keep the crop or switch (name the "
          "alternative if flag is switch). Say once that future years are a scenario if the 2003–2025 trend continues, not a "
          "forecast. Answer in {language}. Format: 'STEP <month>: …' lines, then 'YEAR <year>: …' lines. No markdown.")


def _m(m):
    return (int(m) - 1) % 12 + 1


def _pct(share):
    return None if share is None else round(share * 100)


def season(res):
    crop, sow, risks = res["crop"], res["sow"], res["risks"]
    c = advisor.CROPS.get(crop, {})
    seed, harvest, hz = res["seed"], res["harvest"], res["horizon"]
    out = [
        {"month": _m(sow - 1), "kind": "prepare",
         "values": {"seed_total_kg": seed["total_kg"], "seed_rate_kg_ha": seed["rate_kg_ha"]}},
        {"month": sow, "kind": "sow",
         "values": {"depth_cm": seed["depth_cm"], "row_cm": seed["row_cm"], "score": res["score"],
                    "dry_sowing_pct": _pct(risks.get("dry_sowing"))}},
        {"month": _m(sow + 1), "kind": "establish", "values": {"rain_fail_pct": _pct(risks.get("rain_fail"))}},
    ]
    if c.get("winter"):
        out.append({"month": 1, "kind": "winter", "values": {"frost_pct": _pct(risks.get("frost"))}})
    elif c.get("frost"):
        out.append({"month": _m(sow + 1), "kind": "frost", "values": {"frost_pct": _pct(risks.get("frost"))}})
    elif c.get("flower_frost"):
        out.append({"month": res["key_months"][0], "kind": "frost", "values": {"frost_pct": _pct(risks.get("frost"))}})
    key_vals = {"key_months": res["key_months"], "dry_key_pct": _pct(risks.get("dry_key")), "heat_days": res["heat_days"],
                "watch_dry_spell_alert": True}
    if hz.get("dry_spell_chance_pct") is not None:
        key_vals["dry_spell_next8d_pct"] = hz["dry_spell_chance_pct"]
    out.append({"month": res["key_months"][0], "kind": "key", "values": key_vals})
    hv = TYPICAL_HARVEST.get(crop)
    if hv:
        vals = {"typical_months": hv}
        if harvest:
            vals.update({"harvest_t": harvest["total_t"], "harvest_low_t": harvest.get("total_low_t"),
                         "harvest_high_t": harvest.get("total_high_t"), "harvest_kg_ha": harvest["kg_ha"]})
        out.append({"month": hv[0], "kind": "harvest", "values": vals})
    return out


def years(res):
    sc = res.get("scenario")
    if not sc:
        return []
    return [{"year": r["year"], "score": r["score"], "flag": r["flag"], "dry_key_chance": r["dry_key_chance"],
             "soil_mm_change": r["soil_mm_change"], "temp_change_c": r["temp_change_c"],
             "alternative": r["alternatives"][0] if r.get("alternatives") else None} for r in sc["rows"]]


def _months_txt(ms):
    return "–".join(MONTHS_EN[m - 1][:3] for m in ms)


def _n(x):
    """Plain number text (drops a trailing .0)."""
    return str(int(x)) if isinstance(x, float) and x.is_integer() else str(x)


def _step_txt(s, unit):
    v = s["values"]
    k = s["kind"]
    if k == "prepare":
        return f"get seed: {_n(v['seed_total_kg'])} kg in total ({_n(v['seed_rate_kg_ha'])} kg per ha)"
    if k == "sow":
        d = v["depth_cm"]
        t = f"sow {d[0]}–{d[1]} cm deep, rows {v['row_cm']} cm apart; safety score {v['score']} of 100"
        return t + (f"; too dry at sowing in {v['dry_sowing_pct']}% of years" if v["dry_sowing_pct"] is not None else "")
    if k == "establish":
        return f"rain failed after sowing in {v['rain_fail_pct']}% of years" if v["rain_fail_pct"] is not None else "check emergence"
    if k in ("winter", "frost"):
        head = "winter rest" if k == "winter" else "frost check"
        return head + (f"; frost in {v['frost_pct']}% of years" if v["frost_pct"] is not None else "; no frost numbers")
    if k == "key":
        t = f"sensitive months {_months_txt(v['key_months'])}: too dry in {v['dry_key_pct']}% of years"
        if v["heat_days"] is not None:
            t += f"; {_n(v['heat_days'])} days above 35 °C"
        if v.get("dry_spell_next8d_pct") is not None:
            t += f"; dry-spell chance next 8 days {v['dry_spell_next8d_pct']}%"
        return t + "; watch the 8-day dry-spell alert"
    if k == "harvest":
        t = f"typical harvest {_months_txt(v['typical_months'])}"
        if v.get("harvest_t") is not None:
            t += (f"; national average {v['harvest_kg_ha']} kg per ha = about {_n(v['harvest_t'])} t for the whole field "
                  f"({_n(v['harvest_low_t'])}–{_n(v['harvest_high_t'])} t)")
        return t
    return ""


def messages(res, steps, yrs, notes, lang):
    crop = planner.CROP_EN.get(res["crop"], res["crop"])
    lines = [f"Crop: {crop}, zone {res['zone']['name_en']}, sow {MONTHS_EN[res['sow'] - 1]}, field {_n(res['area'])} {res['unit']}."]
    for s in steps:
        lines.append(f"STEP {MONTHS_EN[s['month'] - 1]}: {_step_txt(s, res['unit'])}")
    for y in yrs:
        alt = y["alternative"]
        t = f"YEAR {y['year']} (scenario): score {y['score']} of 100, flag {y['flag']}"
        if y["dry_key_chance"] is not None:
            t += f", too dry in sensitive months in {_pct(y['dry_key_chance'])}% of years"
        if y["soil_mm_change"] is not None:
            t += f", soil water {y['soil_mm_change']:+} mm vs 2003–21"
        if y["temp_change_c"] is not None:
            t += f", temperature {y['temp_change_c']:+} °C"
        if alt:
            t += f"; best alternative {planner.CROP_EN.get(alt['crop'], alt['crop'])} {alt['score']} of 100"
        lines.append(t)
    if notes.strip():
        lines.append(f"Farmer's notes: {notes.strip()[:500]}")
    lines.append(f"Write all {len(steps)} STEP lines" + (f" and all {len(yrs)} YEAR lines." if yrs else "."))
    language = planner.LANG_NAME.get(lang, "English")
    return [{"role": "system", "content": SYSTEM.format(language=language)}, {"role": "user", "content": "\n".join(lines)}]


def build(body: dict, plan_result):
    """plan_result: a callable returning the /api/plan result for this body (validation included). No LLM call here."""
    res = plan_result()
    steps, yrs = season(res), years(res)
    return {"season": steps, "years": yrs,
            "messages": messages(res, steps, yrs, body.get("notes") or "", body.get("lang") or "en")}
