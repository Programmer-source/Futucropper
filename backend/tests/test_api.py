import os, shutil, tempfile
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)

def test_all_endpoints():
    meta = c.get("/api/meta").json()
    assert not meta["mock"] and len(meta["zones"]) == 5
    for z in [z["zone"] for z in meta["zones"]]:
        n = c.get(f"/api/zones/{z}/now").json()
        assert n["condition"] and n["light_now"] in ("green", "yellow", "red")
        assert [f["lead_months"] for f in n["forecast"]] == [1, 3, 6]
        assert all(f["light"] in ("green", "yellow", "red") for f in n["forecast"])
        assert n["alerts"] and len({a["period_end"] for a in n["alerts"]}) == 1
        assert 1 <= len(n["tips"]) <= 3 and n["why"]["driver"]
        assert c.get(f"/api/zones/{z}/series", params={"variable": "ndvi"}).json()["points"]
        assert c.get(f"/api/zones/{z}/expected").json()["points"]
        assert c.get(f"/api/zones/{z}/context").json()["now"]
    assert c.get("/api/trends").json()["rows"]
    assert c.get("/api/chain").json()["links"]
    cmp = c.get("/api/compare").json(); assert cmp["trends"] and cmp["drivers"]
    assert c.get("/api/skill").json()["rows"]
    assert c.get("/api/events", params={"country": "UA"}).json()
    assert c.get("/api/download/trends.csv").status_code == 200
    a = c.post("/api/assistant", json={"zone": "UA_main", "question": "Why is it dry?", "lang": "en"}).json()
    assert a["mode"] == "offline" and a["facts"]["now"]
    assert c.get("/api/zones/NOPE/now").status_code == 404

def test_new_features():
    # crop advisor: every crop, zone and point path
    opts = c.get("/api/advisor/options").json()
    assert len(opts) >= 8
    for crop, o in opts.items():
        zone = "UA_main" if o["country"] == "UA" else "AU_main"
        r = c.get("/api/advisor", params={"crop": crop, "zone": zone, "irrigated": o["irrigated_only"]}).json()
        assert r["available"] and [m["sow_month"] for m in r["months"]] == o["sow"]
        assert 0 <= r["best"]["score"] <= 100 and r["ranking"] and r["best"]["history"]
    r = c.get("/api/advisor", params={"crop": "maize", "lat": 46.6, "lon": 34.0}).json()
    assert r["zone"]["zone"] == "UA_main" and r["pixel"]["land"] and 0 <= r["pixel"]["best_land"] <= 100
    assert c.get("/api/advisor", params={"crop": "nope", "zone": "UA_main"}).status_code == 404
    assert c.get("/api/advisor", params={"crop": "maize"}).status_code == 422
    # pixel maps: grids have the right size; the dam shows up as a loss
    px = c.get("/api/pixels").json()
    for reg in ("UA", "AU"):
        R = px["regions"][reg]
        for w in R["windows"]:
            assert len(w["best_land"]) == R["nrows"] * R["ncols"] and len(w["condition"]) == len(R["years"])
    # dashboard and browser-LLM prompt
    d = c.get("/api/dashboard").json()["zones"]
    assert len(d) == 5 and all(z["condition"] for z in d)
    m = c.post("/api/assistant/messages", json={"zone": "UA_main", "question": "Why?", "lang": "uk"}).json()["messages"]
    assert m[0]["role"] == "system" and "RESULTS JSON" in m[1]["content"] and '"lead_months":6' not in m[1]["content"]

def test_missing_files(monkeypatch):
    from app import store
    monkeypatch.setattr(store, "ROOT", __import__("pathlib").Path(tempfile.mkdtemp()))
    assert c.get("/api/meta").status_code == 200
    assert c.get("/api/trends").json()["available"] is False
    assert c.get("/api/compare").status_code == 200


def test_plan_spot_llm():
    client = c
    from app import planner
    for crop, place in [("winter_wheat", {"lat": 46.7, "lon": 34.0}), ("rice", {"zone": "AU_main"}), ("sunflower", {"zone": "UA_control"})]:
        for h in ["8d", "1m", "3m", "3y"]:
            r = client.post("/api/plan", json={"crop": crop, "sow": 10 if crop != "sunflower" else 4, "horizon": h, "area": 25, "unit": "acre",
                                               "irrigation": "full" if crop == "rice" else "none", "soil": "loam", **place})
            assert r.status_code == 200, r.text
            j = r.json()
            assert 0 <= j["score"] <= 100 and len(j["months"]) == 12
            assert abs(j["area_ha"] - 25 * 0.404686) < 1e-3
            assert j["ghg"]["per_ha_kg"] > 0 and j["messages"][0]["role"] == "system"
            if h == "3y":
                assert len(j["scenario"]["rows"]) == 3 and j["scenario"]["cells"]["cells"]
            if h == "8d":
                assert "dry_spell_chance_pct" in j["horizon"]
    # IPCC check: 100 kg N, dry climate, no irrigation -> N2O = 100*(0.005+0.11*0.005)*44/28*273
    g = planner.ghg("winter_wheat", 100, "other", "notill", 0, "none", "flooded", 1)
    assert abs(g["parts_kg_ha"]["n2o"] - 100 * (0.005 + 0.11 * 0.005) * 44 / 28 * 273) < 0.2
    g = planner.ghg("rice", 0, "other", "notill", 0, "full", "multiple", 1)
    assert abs(g["ch4_kg_ha"] - 1.19 * 0.55 * 113) < 0.1
    assert client.post("/api/plan", json={"crop": "maize"}).status_code == 422
    assert client.post("/api/plan", json={"crop": "nope", "zone": "UA_main"}).status_code == 404
    s = client.get("/api/spot", params={"lat": -34.6, "lon": 146.0})
    assert s.status_code == 200 and s.json()["crops"] and s.json()["messages"]
    # winter wheat: best month only from the autumn window
    j = client.post("/api/plan", json={"crop": "winter_wheat", "zone": "UA_main", "sow": 3}).json()
    assert j["best_month"] in (9, 10) and "outside_window_winter" in j["warnings"]
