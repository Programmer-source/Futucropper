"""LLM explainer. The model receives ONLY the zone's computed results (logic.context) and must answer
from them, citing the fields it used. Without an API key the endpoint returns mode='offline' and the
frontend shows a template answer built from the same numbers."""
import json
import os

import httpx

API_URL = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")

LEVELS = {
    "farmer": "The user is a farmer. Answer in 2-4 short sentences of plain words, with one practical takeaway. Avoid statistics jargon.",
    "agronomist": "The user is an agronomist. Give the key numbers (z-scores, months of delay, trend per decade) and a short interpretation.",
    "researcher": "The user is a researcher. Give numbers, methods (modified Mann-Kendall, FDR, weather-only model), uncertainty bands and limitations.",
}
LANG = {"uk": "Answer in Ukrainian.", "en": "Answer in English."}

SYSTEM = """You explain drought and field conditions for one farming zone, using ONLY the JSON results provided.
Rules:
- Use only numbers and facts present in the JSON. Never invent or calculate new data. If the answer is not in the JSON, say so plainly.
- After each claim, cite the field you used in square brackets, e.g. [now.forecast lead 3], [trends temp], [sources ndvi].
- "z" values are standard anomalies of the month vs its 2003-2021 average; below -0.5 is risk, below -1 is drought.
- A link between variables is a correlation, not proof of cause; say so if you discuss causes.
- If mock_data is true, mention once that the numbers are demo data.
{level}
{lang}"""


def compact(context: dict) -> dict:
    """Smaller context for small free models: drop long histories, keep every number the app shows."""
    c = json.loads(json.dumps(context, default=str))
    now = c.get("now") or {}
    # the app hides forecasts that did not beat a baseline; the model must not see them either
    now["forecast"] = [f for f in now.get("forecast", []) if f.get("lead_months", 9) <= 3 or f.get("beats_baseline")]
    for f in now.get("forecast", []):
        for k in ("model", "light_model_name", "prob_red", "prob_yellow", "prob_green"):
            f.pop(k, None)
    c["trends"] = [{k: t.get(k) for k in ("variable", "slope_per_decade", "unit", "p_value", "p_value_fdr", "badge")} for t in c.get("trends", [])]
    c["chain"] = [{k: l.get(k) for k in ("from_var", "to_var", "lag_months", "corr", "significant")} for l in c.get("chain", [])]
    c["summary"] = [{k: s.get(k) for k in ("country", "metric", "value", "unit")} for s in c.get("summary", [])]
    c["skill"] = [{k: s.get(k) for k in ("horizon", "rmse", "rmse_persistence", "rmse_climatology", "class_accuracy")} for s in c.get("skill", [])]
    c.pop("sources", None)
    return c


def messages(question: str, context: dict, level: str = "farmer", lang: str = "uk") -> list:
    system = SYSTEM.format(level=LEVELS.get(level, LEVELS["farmer"]), lang=LANG.get(lang, LANG["en"]))
    body = json.dumps(compact(context), ensure_ascii=False, separators=(",", ":"))
    return [{"role": "system", "content": system},
            {"role": "user", "content": f"RESULTS JSON:\n{body}\n\nQUESTION: {question}"}]


def ask(question: str, context: dict, level: str = "farmer", lang: str = "uk") -> dict:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return {"mode": "offline"}
    system = SYSTEM.format(level=LEVELS.get(level, LEVELS["farmer"]), lang=LANG.get(lang, LANG["en"]))
    body = {
        "model": MODEL,
        "max_tokens": 700,
        "system": system,
        "messages": [{"role": "user", "content": f"RESULTS JSON:\n{json.dumps(context, ensure_ascii=False, default=str)}\n\nQUESTION: {question}"}],
    }
    try:
        r = httpx.post(API_URL, json=body, timeout=60,
                       headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        return {"mode": "llm", "answer": text, "model": MODEL}
    except httpx.HTTPError as e:
        return {"mode": "error", "error": str(e)[:300]}
