"""Reads the contract files (see CONTRACTS.md). Results are produced by the data/model pipeline;
the API only reads, filters and combines them. A missing file returns None, never an error."""
import json
import os
from functools import lru_cache
from pathlib import Path

import pandas as pd

ROOT = Path(os.environ.get("FTG_DATA_ROOT", Path(__file__).resolve().parents[2]))

FILES = {
    "series": "data/processed/all_series.parquet",
    "zones": "data/zones.csv",
    "events": "data/events.csv",
    "data_dates": "data/data_dates.csv",
    "sources": "data/sources.csv",
    "tips_rules": "data/tips_rules.csv",
    "trends": "results/trends.csv",
    "lags": "results/lags.csv",
    "expected": "results/expected_vs_actual.parquet",
    "forecast": "results/forecast.parquet",
    "skill": "results/model_skill.csv",
    "importance": "results/feature_importance.csv",
    "alerts": "results/alerts.csv",
    "summary": "results/summary.csv",
}
JSON_FILES = {"pixels": "results/pixel_maps.json"}
DATE_COLS = ("date", "issue_date", "target_date", "start", "end", "period_start", "period_end", "last_date")


@lru_cache(maxsize=64)
def _read(path: str, mtime: float) -> pd.DataFrame:
    df = pd.read_parquet(path) if path.endswith(".parquet") else pd.read_csv(path)
    for c in DATE_COLS:
        if c in df.columns:
            df[c] = pd.to_datetime(df[c])
    return df


def load(name: str):
    p = ROOT / FILES[name]
    if not p.exists():
        return None
    return _read(str(p), p.stat().st_mtime)


def is_mock() -> bool:
    s = load("series")
    return bool(s is not None and s["source"].astype(str).str.contains("MOCK").any())


def records(df: pd.DataFrame | None) -> list:
    """DataFrame -> JSON-safe list of dicts (dates as YYYY-MM-DD, NaN as null)."""
    if df is None:
        return []
    out = df.copy()
    for c in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[c]):
            out[c] = out[c].dt.strftime("%Y-%m-%d")
    return json.loads(out.to_json(orient="records", force_ascii=False))
