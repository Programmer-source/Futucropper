"""Follow the Gas API.   Run:  uvicorn app.main:app --reload --port 8000   (from backend/)"""
import io
import os

from dotenv import load_dotenv

load_dotenv()

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import advisor, assistant, llm, logic, planner, store

app = FastAPI(title="Follow the Gas API", version="0.5.0")
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


def _zone_or_404(zone: str) -> dict:
    info = logic.zone_info(zone)
    if info is None:
        raise HTTPException(404, f"Unknown zone {zone}")
    return info


@app.get("/api/health")
def health():
    return {"ok": True, "missing": [k for k in store.FILES if store.load(k) is None]}


@app.get("/api/meta")
def meta():
    s = store.load("series")
    return {
        "mock": store.is_mock(),
        "zones": store.records(store.load("zones")),
        "variables": sorted(s["variable"].unique().tolist()) if s is not None else [],
        "years": [int(s["date"].dt.year.min()), int(s["date"].dt.year.max())] if s is not None else None,
        "data_dates": store.records(store.load("data_dates")),
        "thresholds": {"z_yellow": logic.Z_YELLOW, "z_red": logic.Z_RED},
        "llm": bool(os.environ.get("OPENROUTER_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")),
        "llm_provider": ("openrouter" if os.environ.get("OPENROUTER_API_KEY")
                         else "claude" if os.environ.get("ANTHROPIC_API_KEY") else "browser"),
    }


@app.get("/api/zones/{zone}/now")
def zone_now(zone: str):
    _zone_or_404(zone)
    return logic.now(zone)


@app.get("/api/zones/{zone}/series")
def zone_series(zone: str, variable: str, start: int | None = None, end: int | None = None):
    _zone_or_404(zone)
    s = store.load("series")
    if s is None:
        return {"available": False, "points": []}
    d = s[(s["zone"] == zone) & (s["variable"] == variable)].sort_values("date")
    if start:
        d = d[d["date"].dt.year >= start]
    if end:
        d = d[d["date"].dt.year <= end]
    return {"available": True, "unit": d["unit"].iloc[0] if not d.empty else None,
            "points": store.records(d[["date", "value"]])}


@app.get("/api/trends")
def trends(zone: str | None = None):
    t = store.load("trends")
    if t is None:
        return {"available": False, "rows": []}
    return {"available": True, "rows": store.records(t if zone is None else t[t["zone"] == zone])}


@app.get("/api/zones/{zone}/expected")
def expected(zone: str):
    _zone_or_404(zone)
    e = store.load("expected")
    if e is None:
        return {"available": False, "points": []}
    return {"available": True, "points": store.records(e[e["zone"] == zone].sort_values("date"))}


@app.get("/api/chain")
def chain():
    lags = store.load("lags")
    return {"available": lags is not None, "links": store.records(lags),
            "summary": store.records(store.load("summary"))}


@app.get("/api/compare")
def compare():
    return logic.compare()


@app.get("/api/skill")
def skill():
    s = store.load("skill")
    return {"available": s is not None, "rows": store.records(s)}


@app.get("/api/events")
def events(country: str | None = None):
    e = store.load("events")
    if e is None:
        return []
    if country:
        e = e[e["country"].isin([country, "ALL"])]
    return store.records(e)


@app.get("/api/sources")
def sources():
    return {"sources": store.records(store.load("sources")), "data_dates": store.records(store.load("data_dates"))}


@app.get("/api/zones/{zone}/context")
def zone_context(zone: str):
    _zone_or_404(zone)
    return logic.context(zone)


@app.get("/api/dashboard")
def dashboard():
    """Every zone at a glance: light now, outlook, active alerts, soil moisture."""
    z = store.load("zones")
    out = []
    for r in ([] if z is None else store.records(z)):
        n = logic.now(r["zone"])
        soil = next((c["z"] for c in (n["why"] or {}).get("chain", []) if c["variable"] == "soil_moisture"), None)
        out.append({"zone": r, "condition": n["condition"], "light_now": n["light_now"],
                    "forecast": [f for f in n["forecast"] if f["lead_months"] <= 3 or f["beats_baseline"]],
                    "alerts": n["alerts"], "soil_z": soil, "tips": n["tips"]})
    return {"zones": out}


@app.get("/api/pixels")
def pixels():
    p = advisor.pixels()
    if p is None:
        raise HTTPException(404, "Pixel maps not built yet (run pipeline/build_pixel_maps.py)")
    return p


@app.get("/api/advisor/options")
def advisor_options():
    return advisor.options()


@app.get("/api/advisor")
def advise(crop: str, zone: str | None = None, sow: int | None = None, irrigated: bool = False,
           lat: float | None = Query(None, ge=-90, le=90), lon: float | None = Query(None, ge=-180, le=180)):
    if crop not in advisor.CROPS:
        raise HTTPException(404, f"Unknown crop {crop}")
    if zone is None:
        if lat is None or lon is None:
            raise HTTPException(422, "Give a zone or a point (lat, lon)")
        zone = advisor.zone_for_point(lat, lon, advisor.CROPS[crop]["country"])
    _zone_or_404(zone)
    return advisor.advise(zone, crop, sow, irrigated, lat, lon)


class Question(BaseModel):
    zone: str
    question: str
    level: str = "farmer"
    lang: str = "uk"


@app.post("/api/assistant/messages")
def ask_messages(q: Question):
    """The exact system prompt + results context, for an LLM called from the user's browser (no server key)."""
    _zone_or_404(q.zone)
    ctx = logic.context(q.zone)
    return {"messages": assistant.messages(q.question[:1000], ctx, q.level, q.lang),
            "facts": {"now": ctx["now"], "zone": ctx["zone"], "data_dates": ctx["data_dates"]}}


@app.post("/api/assistant")
def ask(q: Question):
    _zone_or_404(q.zone)
    ctx = logic.context(q.zone)
    res = assistant.ask(q.question[:1000], ctx, q.level, q.lang)
    res["facts"] = {"now": ctx["now"], "zone": ctx["zone"], "data_dates": ctx["data_dates"]}
    return res


class PlanIn(BaseModel):
    crop: str
    zone: str | None = None
    lat: float | None = None
    lon: float | None = None
    sow: int | None = None
    irrigation: str = "none"
    soil: str = "unknown"
    area: float = 1
    unit: str = "ha"
    n_kg_ha: float | None = None
    fert: str = "other"
    tillage: str = "reduced"
    fuel_l_ha: float | None = None
    rice_water: str = "flooded"
    horizon: str = "3m"
    notes: str = ""
    lang: str = "en"


@app.post("/api/plan")
def plan(p: PlanIn):
    if p.crop not in advisor.CROPS:
        raise HTTPException(404, f"Unknown crop {p.crop}")
    if p.sow is not None and not 1 <= p.sow <= 12:
        raise HTTPException(422, "sow must be 1-12")
    if p.zone is None and (p.lat is None or p.lon is None):
        raise HTTPException(422, "Give a zone or a point (lat, lon)")
    if p.zone is not None:
        _zone_or_404(p.zone)
    res = planner.plan(p.model_dump())
    if not res.get("available"):
        raise HTTPException(404, "No data for this place")
    res["messages"] = planner.plan_messages(res, p.notes[:1500], p.lang)
    return res


@app.get("/api/spot")
def spot(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180), lang: str = "en", q: str = ""):
    res = planner.spot(lat, lon)
    if not res.get("available"):
        raise HTTPException(404, "No data")
    res["messages"] = planner.spot_messages(res, q[:800], lang)
    return res


class LLMIn(BaseModel):
    messages: list[dict]


@app.post("/api/llm")
def llm_proxy(body: LLMIn):
    """Server-side call to the free LLM (no Origin header, so browser blocks do not apply); Claude if a key is set."""
    out = llm.chat(body.messages[:4])
    if not out.get("text"):
        raise HTTPException(502, out.get("error", "LLM unavailable"))
    return out


DOWNLOADABLE = ["series", "trends", "lags", "expected", "forecast", "skill", "importance", "alerts", "summary",
                "zones", "events", "sources", "data_dates"]


@app.get("/api/download/{name}.csv")
def download(name: str):
    if name not in DOWNLOADABLE:
        raise HTTPException(404, "Unknown file")
    df = store.load(name)
    if df is None:
        raise HTTPException(404, "Not available yet")
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
