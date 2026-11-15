# Futucropper

**Where and when to farm, from NASA satellites.**
NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*

Futucropper is a free web app (with an Android version) that takes 23 years of NASA satellite data (2003–2025) and turns it into simple farming answers: where the land is good, when to sow, how risky a plan is, and how much greenhouse gas it produces.

We built it around two places with very different stories: southern Ukraine around the destroyed Kakhovka dam and some other southern regions, and the Murrumbidgee irrigation area in Australia.

---

## Goal

We wanted to answer one question:

> Can NASA Earth observations help a farmer pick a less risky crop plan and see lower-emission options, without hiding uncertainty or pretending satellites measure profit or emissions directly?

The idea is simple. Before buying seed, fertiliser or fuel, a farmer should be able to compare a risky plan with a safer one, see *why* it is risky, and check what a change in practice does to emissions.

---

## The problem

Because of different ecological factors, the crops can grow badly. So the farmers have to plan their crops years ahead, but predicting is almost impossible for humans and requires so much time to analyze different factors.

The data already exists. Farmers just can't use it, because it is not systematized and scattered all across the internet.

To plan one field today, a farmer has to check a satellite map for greenness, a weather service for rain, an agronomy guide for sowing dates and a separate calculator for emissions. Most farmers don't have the time or the software for that.

Our two regions show why this matters:

- **Australia, drought and limited water.** At the end of the 2018–19 drought, Murrumbidgee general-security water allocation was only **7%**. Water delivered to rice dropped from **220,423 ML** (2017–18) to **37,171 ML** (2018–19).
- **Ukraine, lost irrigation.** The Kakhovka dam was destroyed on **6 June 2023**. A Government of Ukraine / UN assessment found about **243,600 ha** of irrigated land expected to lose yield without its old water supply. Here good weather can't fix the problem, because the water network itself is gone.

On top of that, farming adds to the problem: nitrogen fertiliser, diesel and flooded rice all release greenhouse gases that warm the climate and make droughts more likely.

---

##Research

In the course of creation of this project, a research paper regarding the problem and its releativity was written. Exploring the current consequences and possible solutions:
[Research report](docs/Futucropper_Evidence_and_Impact_Research_Report.pdf)

---

## The solution

One app, three main screens, five languages (English, Ukrainian, German, French, Italian).

**Map.** Pick a country and a crop culture. The map colours every 5 km cell by how well and how steadily it grew in that crop's months. Each study zone shows its best sowing month. Click anywhere to see the facts for that spot, ask the AI about it, or plan a field there.

**Plan.** Enter your place, crop, sowing month, soil, irrigation, field size and a few optional details, then press *Calculate*. You get:
- a safety score from 0 to 100 with the main reasons (dry soil at sowing, failed rain, dry key months, heat, frost)
- a score for every month, so you can see if another month is better
- a step-by-step season guide for beginners
- seed amount, rows and depth for your field
- an estimate of the field's greenhouse gases, with "Try it" buttons (less nitrogen, no-till, draining rice) that recalculate the number
- an outlook: dry-spell chance for the next 8 days, a 1–3 month forecast, or a scenario up to 10 years

**See the Future.** Press play and watch the land change season by season, from winter 2003 to autumn 2035. Past seasons are real satellite data, the next months come from our model, and 2026–2035 is clearly marked as a scenario "if the 2003–2025 trend continues". The AI writes a short note on what changed.

**Science.** Detailed pages for judges and researchers: trends, how drought spreads from rain to soil to plants, Ukraine vs Australia, model accuracy and the "what weather alone would predict" analysis.

---

## How it works

### Data
| Source | What we use it for |
|---|---|
| NASA MODIS MOD13C2 | field greenness (NDVI) |
| NASA GPM IMERG V07 | rain and dry spells |
| NASA GLDAS Noah 2.1 | soil moisture and evaporation |
| NASA MERRA-2 | temperature, heat and frost days |
| NOAA GML / NOAA PSL | CO₂ and El Niño index |
| World Bank | national cereal yields |
| IPCC 2019 Refinement, AR6 | emission factors and warming potentials |

### Method, in plain words
1. Every month is compared with the same month in 2003–2021, so "dry" means dry for *that* place and season.
2. Trends are tested with Mann–Kendall and Sen's slope, with a correction for testing many things at once.
3. Forecast models (ridge, gradient boosting, extra trees) are trained on old years and tested only on 2022–2025. The 6-month forecast didn't beat a simple guess, so we hide it.
4. A weather-only model predicts how green the fields *should* be. The gap between that and what the satellite saw shows effects the weather doesn't explain, like lost irrigation.
5. Emissions use IPCC Tier 1 factors (nitrogen N₂O, urea CO₂, diesel, rice methane).
6. The AI only explains numbers the app already computed. It never makes up its own.

### Tech
- **Backend:** Python, FastAPI, pandas. Deployed on Render.
- **Frontend:** Next.js (React), Tailwind, Leaflet maps, Recharts. Deployed on Vercel.
- **AI:** OpenRouter through the backend, with a free model as a backup.
- **Android:** a separate build with offline mode that keeps saved data and plans.

---

## What we found

These are our own results. They still need someone else to repeat them.

- **Kakhovka:** after June 2023, fields fell **−0.49** (standard score) below rainfed control areas, more than the weather explains (95% CI −0.86 to −0.25).
- **Murrumbidgee:** in the 2018–19 drought, the irrigated zone did **+7.4%** better than its rainfed neighbour.
- **Forecasts:** the 1-month forecast error is **0.62** vs **0.92** for "assume a normal year".
- **Soil:** soil moisture in southern Ukraine is going down by about 8 kg/m² per decade. This is **not** statistically confirmed yet, and the app says so.

---

## What the numbers do and don't mean

We try hard not to overclaim.

- **82/100 is a comparison score**, not an 82% chance of a good harvest.
- **5 km cells are a display grid.** They are not exact field borders.
- **Emissions are estimates** from IPCC factors, not measurements from a real farm.
- **2026–2035 is a scenario**, not a forecast. Only the next 1–3 months are forecasts.
- **Seed rates and sowing windows are typical values.** Local agronomy guides and advisers should always have the final word.

---

## Similar apps, and why use ours

| | Futucropper | EOSDA Crop Monitoring | OneSoil | Cool Farm Tool | GEOGLAM / FAO ASIS |
|---|---|---|---|---|---|
| 23 years of history per location | yes | partial | partial | no | regional |
| Best sowing month and risk score for a crop | yes | no | no | no | no |
| Reasons behind the risk | yes | partial | no | no | regional |
| Emissions next to the crop plan | yes | no | no | yes | no |
| Emissions "what if" changes | yes | no | no | yes | no |
| 1–3 month outlook | yes | partial | no | no | yes |
| Separates weather from lost irrigation | yes | no | no | no | in reports |
| Plain-language AI explanation | yes | no | no | no | no |
| Live field imagery | monthly | yes | yes | no | regional |
| Exact field borders | no | yes | yes | no | no |
| Free | yes | paid plans | free basic | free for farmers | yes |

*This is our own comparison of the tools, not a full market audit. Check other products' websites for their current features.*

**Why choose Futucropper?** Other tools are better at watching a field right now and drawing exact borders. Futucropper does something different: it puts the long history, a concrete crop-and-month plan, its emissions and a plain explanation on one page, for free, in five languages. A farmer gets a decision instead of four separate tools.

---

## Project files

| Folder or file | What it does |
|---|---|
| `README.md` | Overview and how to run the app |
| `CONTRACTS.md` | Exact names and formats of every data file the pipeline writes and the app reads |
| **backend/app/** | |
| `main.py` | The web server and all `/api/...` endpoints |
| `store.py` | Reads data files, with caching |
| `logic.py` | Prepares data for each screen; drought traffic-light rules |
| `advisor.py` | Risk for each sowing month: dry soil, failed rain, heat, frost |
| `planner.py` | The Plan calculation: score, seed, harvest, soil water, emissions, scenario, AI prompts |
| `steps.py` | The step-by-step season guide |
| `future.py` | See the Future: seasons, forecasts, scenario, "What changed" |
| `assistant.py` | Prompt for the Science assistant |
| `llm.py` | Calls the AI: OpenRouter first, then the free backup |
| `tests/` | Checks that the endpoints return correct numbers |
| **frontend/src/** | |
| `app/page.tsx` | Map tab |
| `app/plan/page.tsx` | Plan tab with all result cards |
| `app/future/page.tsx` | See the Future tab |
| `app/science/…` | Science pages (now, trends, chain, expected, compare, dashboard, assistant, expert, roadmap) |
| `components/` | Header, maps, loader, intro, flags, theme switch, AI box, charts |
| `lib/` | Backend calls, AI calls, translations, formatting, map images |
| `i18n/` | Texts in five languages |
| **data/** | Monthly NASA series per zone, zone borders, events, sources |
| **results/** | Precomputed forecasts, trends, alerts, expected vs actual, map grids, scenario cells |
| **pipeline/** | How the data and results were made: input tables, the model notebook, export and map-building scripts |
| **mobile-build/** | The Android app with offline mode |

Secrets (the AI key) live only in `backend/.env` on the developer's computer and in Render's settings. They are never in git.

---

## How to RUN

```bash
# backend
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
copy .env.example .env.local   # macOS/Linux: cp
npm run dev
```

Open http://localhost:3000.

---

## Sources

- NASA Earthdata: MODIS MOD13C2 · NASA GPM IMERG · NASA GES DISC GLDAS · NASA GMAO MERRA-2
- NOAA Global Monitoring Laboratory · NOAA PSL climate indices · World Bank cereal yield
- IPCC (2019) Refinement to the 2006 Guidelines, Vol. 4 · IPCC AR6 WG1
- NSW DPI 2018–19 water conditions · Murrumbidgee Irrigation Annual Compliance Report 2018–19 · NSW Water allocations
- Government of Ukraine & UN, Kakhovka Dam Post-Disaster Needs Assessment (2023) · World Bank Kakhovka impact analysis
- NSW DPI and GRDC crop guides (sowing windows and seed rates)

**AI usage:** Some parts of code were generated by some generative AI models, such as Claude or Gemini, but carefully reviewed by us after. The in-app assistant uses a language model through OpenRouter.