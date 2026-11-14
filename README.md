# Follow the Gas

Drought watch for irrigated farmland in southern Ukraine and Australia, built on NASA satellite data.

- `backend/`: Python **FastAPI**, reads the result files and serves them as JSON, plus the AI assistant.
- `frontend/`: **Next.js** (React, TypeScript, Tailwind) interface in Ukrainian and English.
- `data/`, `results/`: the files the app reads (formats in **CONTRACTS.md**). They hold **real NASA data and the
  model team's results**, built by `pipeline/` (see below). No demo data is left.
- `pipeline/`: NASA feature tables → model team's notebook → app files.

## Run on your computer (two terminals)

**1. Backend** (Python 3.11+)
```
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```
Check: http://localhost:8000/api/health and http://localhost:8000/docs

**2. Frontend** (Node.js 20+)
```
cd frontend
npm install
copy .env.example .env.local       # Windows  (macOS/Linux: cp .env.example .env.local)
npm run dev
```
Open http://localhost:3000 . Add `?lang=en` for English.

## Data and models (`pipeline/`)

`python pipeline/build_scenario.py` builds `results/scenario_cells.json` (NASA GLDAS 0.25° cells) for the multi-year Plan map.

Everything in `data/` and `results/` is already built, so you only need this to rebuild after new data.
```
python -m pip install -r pipeline/requirements.txt
python pipeline/run_models.py       # runs forecast_pipeline.ipynb (model team) on feature_csvs/  -> model_outputs/   (~1 min)
python pipeline/export_for_app.py   # feature_csvs/ + model_outputs/ -> data/ and results/                       (~1 min)
python pipeline/build_pixel_maps.py # MODIS pixels -> results/pixel_maps.json (field map, planner)                 (~5 s)
```
| Folder / file | What it is |
|---|---|
| `pipeline/feature_csvs/` | 15 tables from NASA MODIS, GPM IMERG, GLDAS, MERRA-2 (+ NOAA indices and gases, World Bank yields), 5 zones, 2003 to Nov 2026 |
| `pipeline/forecast_pipeline.ipynb`, `model_report_uk.pdf` | Model team's notebook and report (unchanged) |
| `pipeline/model_outputs/` | Notebook outputs. `run_models.py` reproduces them exactly (checked: max difference 1e-16) |
| `pipeline/export_for_app.py` | Converts to the app formats. It also recomputes, with the notebook's own model settings, three things the notebook does not save: per-zone test accuracy, the weather-only "expected" line for 2003–2021 (out-of-sample), and which factor the 1-month forecast relies on most. It stops if it cannot reproduce the notebook's own numbers. |

Where the app's numbers come from: forecast and drought light (models 01 and 02), trends (06), drought chain (07),
expected vs actual (04), 8-day dry-spell forecast (08) — model team; Ukraine vs Australia summary — `export_for_app.py`,
from the expected-vs-actual results (definitions are in the `definition` column of `results/summary.csv`).

**Data dates.** Field greenness and soil moisture end in December 2025 (latest NASA monthly files when the data was
pulled), so forecasts start from that month. Rainfall is daily to 13 Nov 2026, temperature to 30 Sep 2026.
To move the forecast forward, pull the newer monthly NASA files, rebuild `feature_csvs/` with the same method, then
run the two commands above.

`backend/mock/make_mock.py` still exists for testing on a copy, but it refuses to run without `--force` because it would
overwrite the real data.

## AI (works without any key)

There is no model picker. `frontend/src/lib/llm.ts` → `askAI()` tries, in order:
1. Claude through the backend, only if `ANTHROPIC_API_KEY` is set;
2. the free Pollinations model from the browser (`POST /openai` with `private:true`, then `GET`); when the free tier
   says "1 reply every 45 seconds per IP" (HTTP 402/429) it waits the seconds it asks for and retries;
3. the backend proxy `POST /api/llm`, a server-side request with no browser Origin, for when the browser is blocked (HTTP 403).
Requests are queued one at a time. The prompt contains only the numbers on the page (`planner.plan_messages`, `spot_messages`).

## Pages

- **Map** (`/`, opens first): one map per country. Colour = land score for the chosen crop (MODIS 5 km), box labels = best
  sowing month and weather-safety score per zone, outline colour = field state now. Click any spot → facts (`/api/spot`),
  "Ask AI about this spot", "Plan a field here".
- **Plan** (`/plan`): 7 steps (place, crop, any of 12 months, soil/irrigation/size in ha/acres/sotka/m²/km², optional
  N/fertiliser/tillage/diesel/rice water, notes, horizon 8 days…10 years) → **Calculate** → score with reasons, month bars,
  outlook, AI analysis, seed amount and rows with the field drawn to scale, soil water (FAO-56), national cereal yield,
  greenhouse gases (IPCC 2019 Tier 1 + AR6 GWP) with "Try it" cuts that recalculate, and for 1–10 years an animated
  "if the 2003–2025 trend continues" map (NASA GLDAS cells) with a flag and an AI tip per season.
- **Science** (`/science`): the detailed pages (now, compare, trends, chain, expected vs actual, dashboard, assistant, expert, roadmap).

Languages: English (default), Ukrainian, German, French, Italian (selector top right; `?lang=de` works too).

## Deploy
- **Backend → Render** (free web service): root `backend`, build `pip install -r requirements.txt`,
  start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `CORS_ORIGINS=https://<your-site>.vercel.app`
  and optionally `ANTHROPIC_API_KEY`. Commit `data/` and `results/` so the server has them.
- **Frontend → Vercel**: import the repo, root directory `frontend`, env `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com`.

## Structure
```
backend/app/store.py      reads contract files (cached; missing file -> None)
backend/app/logic.py      traffic light, "why", tips, comparison  (thresholds live here only)
backend/app/assistant.py  Claude API call with results-only context
backend/app/main.py       API routes
frontend/src/i18n/*.json  every visible word, Ukrainian and English
frontend/src/app/*        pages;  frontend/src/components/*  field strip, map, charts
```

## Not done yet
- NASA monthly data for 2026 (greenness, soil moisture), so the forecast starts from the latest month.
- Any region (draw your own area), automatic 8-day updates, Telegram/phone push, cropland mask: see the Roadmap page.
- "Learning from each other" text (Australian part of the team).
- Roadmap: draw your own area, multi-region dashboard, push/Telegram alerts, automatic 8-day updates
  (planned as a scheduled GitHub Action that rebuilds `results/`).
