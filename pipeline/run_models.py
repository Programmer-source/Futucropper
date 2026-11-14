"""Runs the model team's notebook (forecast_pipeline.ipynb) as a plain script, without Jupyter.

Inputs : pipeline/feature_csvs/*.csv
Outputs: pipeline/model_outputs/  (predictions.csv, metrics.csv, trends_06.csv, chain_*, human_effect_*, ...)

    python pipeline/run_models.py

The notebook code is not changed; only its input/output folders are pointed at this repo.
Takes about one minute. A rerun on the same CSVs gives the same numbers (fixed seeds).
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NB = HERE / "forecast_pipeline.ipynb"
DATA_DIR = HERE / "feature_csvs"
OUT_DIR = HERE / "model_outputs"


def notebook_code() -> str:
    nb = json.loads(NB.read_text(encoding="utf-8"))
    parts = []
    for cell in nb["cells"]:
        if cell["cell_type"] != "code":
            continue
        src = "".join(cell["source"])
        # skip shell / magic lines
        src = "\n".join("# " + l if l.strip().startswith(("!", "%")) else l for l in src.split("\n"))
        parts.append(src)
    code = "\n\n".join(parts)
    code = code.replace("DATA_DIR = '/content' if IN_COLAB else '/mnt/user-data/uploads'", f"DATA_DIR = {str(DATA_DIR)!r}")
    code = code.replace("OUT_DIR = '/content/outputs' if IN_COLAB else '/mnt/user-data/outputs'", f"OUT_DIR = {str(OUT_DIR)!r}")
    if str(DATA_DIR) not in code or str(OUT_DIR) not in code:
        sys.exit("Could not set the notebook's DATA_DIR/OUT_DIR. Was the first code cell changed?")
    return code


if __name__ == "__main__":
    os.environ.setdefault("MPLBACKEND", "Agg")
    OUT_DIR.mkdir(exist_ok=True)
    g = {"__name__": "__notebook__", "display": print}
    exec(compile(notebook_code(), str(NB), "exec"), g)
    print(f"\nModel outputs written to {OUT_DIR}")
