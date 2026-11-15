"""See the Future tab: season frames read straight from the files, and the cached AI explain (LLM stubbed)."""
import pandas as pd
from fastapi.testclient import TestClient

from app import future, store
from app.main import app

c = TestClient(app)


def _frames(region):
    d = c.get(f"/api/future?region={region}").json()
    return d, {f["id"]: f for f in d["frames"]}


def test_season_timeline():
    d, f = _frames("UA")
    assert d["frames"][0]["id"] == "2003-DJF" and d["frames"][-1]["id"] == "2035-SON"
    assert len(d["frames"]) == (2025 - 2003 + 1) * 4 + 10 * 4
    assert f["2025-SON"]["kind"] == "obs" and f["2026-DJF"]["kind"] == "fc" and f["2026-JJA"]["kind"] == "sc"
    # lead 6 is hidden: only leads 1 and 3 are placed
    leads = [x["lead_months"] for fr in d["frames"] if fr["kind"] == "fc" for z in fr["zones"].values() for x in z["forecast"]]
    assert set(leads) <= {1, 3} and leads
    # Dec 2002 is missing, so the first DJF has no values (None, never 0)
    assert f["2003-DJF"]["zones"]["UA_main"]["rain_mm"] is None
    assert c.get("/api/future?region=XX").status_code == 422


def test_card_values_by_hand():
    _, f = _frames("UA")
    s = store.load("series")
    z = s[(s.zone == "UA_main")].set_index(["variable", "date"])["value"]
    months = [pd.Timestamp(2024, m, 1) for m in (6, 7, 8)]
    rain = sum(z[("precip", m)] * m.days_in_month for m in months)
    card = f["2024-JJA"]["zones"]["UA_main"]
    assert card["rain_mm"] == round(rain)
    assert abs(card["temp_c"] - sum(z[("temp", m)] for m in months) / 3) < 0.051
    assert abs(card["soil_mm"] - sum(z[("soil_moisture", m)] for m in months) / 3) < 0.051
    # DJF 2024 = Dec 2023 + Jan 2024 + Feb 2024
    djf = [pd.Timestamp(2023, 12, 1), pd.Timestamp(2024, 1, 1), pd.Timestamp(2024, 2, 1)]
    assert f["2024-DJF"]["zones"]["UA_main"]["rain_mm"] == round(sum(z[("precip", m)] * m.days_in_month for m in djf))


def test_explain_cached_and_short(monkeypatch):
    calls = []
    monkeypatch.setattr(future.llm, "chat", lambda m: calls.append(m) or {"text": "ok", "provider": "stub"})
    future._EXPLAIN.clear()
    r1 = c.get("/api/future/explain?region=UA&year=2024&season=JJA&lang=en").json()
    r2 = c.get("/api/future/explain?region=UA&year=2024&season=JJA&lang=en").json()
    assert r1 == r2 == {"text": "ok", "provider": "stub"} and len(calls) == 1
    msgs = calls[0]
    assert sum(len(m["content"]) for m in msgs) < 900 and "Kakhovka dam" in msgs[1]["content"]
    monkeypatch.setattr(future.llm, "chat", lambda m: {"text": None, "error": "down"})
    assert c.get("/api/future/explain?region=AU&year=2019&season=DJF&lang=uk").json() == {"text": None}
    future._EXPLAIN.clear()
