"""/api/plan/steps: deterministic steps copied from /api/plan for the same body, plus the LLM prompt (no LLM call)."""
from fastapi.testclient import TestClient

from app import llm, steps
from app.main import app

c = TestClient(app)
CASES = [
    (dict(crop="winter_wheat", zone="UA_main", sow=9, horizon="5y", area=10, lang="en"), 5),
    (dict(crop="rice", zone="AU_main", horizon="3y", irrigation="full", lang="uk"), 3),
]


def pct(share):
    return None if share is None else round(share * 100)


def test_steps_match_plan(monkeypatch):
    def no_llm(m):
        raise AssertionError("the steps endpoint must not call the LLM")
    monkeypatch.setattr(llm, "chat", no_llm)
    for body, n_years in CASES:
        r = c.post("/api/plan/steps", json=body)
        assert r.status_code == 200
        out, plan = r.json(), c.post("/api/plan", json=body).json()
        assert set(out) == {"season", "years", "messages"}
        season = out["season"]
        assert 5 <= len(season) <= 7
        assert len(out["years"]) == n_years
        by = {s["kind"]: s for s in season}
        sd, rk = plan["seed"], plan["risks"]
        assert by["prepare"]["values"] == {"seed_total_kg": sd["total_kg"], "seed_rate_kg_ha": sd["rate_kg_ha"]}
        assert by["sow"]["month"] == plan["sow"]
        assert by["sow"]["values"] == {"depth_cm": sd["depth_cm"], "row_cm": sd["row_cm"], "score": plan["score"],
                                       "dry_sowing_pct": pct(rk["dry_sowing"])}
        assert by["establish"]["values"]["rain_fail_pct"] == pct(rk["rain_fail"])
        assert by["key"]["month"] == plan["key_months"][0]
        assert by["key"]["values"]["key_months"] == plan["key_months"]
        assert by["key"]["values"]["dry_key_pct"] == pct(rk["dry_key"]) and by["key"]["values"]["heat_days"] == plan["heat_days"]
        hv = by["harvest"]["values"]
        assert hv["typical_months"] == steps.TYPICAL_HARVEST[body["crop"]]
        if plan["harvest"]:
            assert hv["harvest_t"] == plan["harvest"]["total_t"] and hv["harvest_kg_ha"] == plan["harvest"]["kg_ha"]
        else:
            assert "harvest_t" not in hv
        for y, row in zip(out["years"], plan["scenario"]["rows"]):
            assert (y["year"], y["score"], y["flag"], y["dry_key_chance"], y["soil_mm_change"], y["temp_change_c"]) == \
                (row["year"], row["score"], row["flag"], row["dry_key_chance"], row["soil_mm_change"], row["temp_change_c"])
            assert y["alternative"] == (row["alternatives"][0] if row["alternatives"] else None)
        # the prompt: system + user, one STEP line per step and one YEAR line per year, in the user's language, no "/"
        sysm, user = out["messages"]
        assert sysm["role"] == "system" and user["role"] == "user"
        assert ("Ukrainian" if body["lang"] == "uk" else "English") in sysm["content"]
        assert user["content"].count("\nSTEP ") == len(season) and user["content"].count("\nYEAR ") == n_years
        assert "/" not in user["content"]
        assert str(plan["score"]) in user["content"]


def test_steps_validation():
    assert c.post("/api/plan/steps", json=dict(crop="nope", zone="UA_main")).status_code == 404
    assert c.post("/api/plan/steps", json=dict(crop="winter_wheat")).status_code == 422
