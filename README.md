# Futucropper

Futucropper is a drought watch for irrigated farmland. We built it for two places: the Kakhovka irrigation area in southern Ukraine and the Murrumbidgee irrigation area in Australia.

For one zone at a time, it answers three questions in plain language:

1. How are the fields doing compared with a normal year for this month?
2. Is drought likely in the next 1–3 months?
3. Why? Is it the weather, a long-term trend, El Niño or the NAO, or the lost irrigation water?

All numbers come from public NASA and NOAA data: monthly series since 2003, averaged over each zone.

![Fields now page](docs/screenshot-fields-now.png)

> **Current state:** the app works end to end, but it still runs on **generated demo data**. The files in `data/` and `results/` have the final formats, and every page shows a "Demo data" banner until the real pipeline output replaces them. The real Ukraine series are collected; the Australia series, NDVI and the model are not finished yet.

## Why we made it

In June 2023 the Kakhovka dam was destroyed and the irrigation canals in the south of Ukraine went dry. Since then, every bad field has the same question attached to it: is this the drought, the war, or the missing water? Satellite field apps show *that* a field is stressed. They don't say which of these is the cause.

We wanted a tool that keeps those causes apart. The Murrumbidgee is in the project because Australian irrigators had their water cut during the Millennium Drought, and that region has 20 years of records on what happened next.

## What we found so far

This comes from our first pass over the southern Ukraine data, 2003–2025 (MERRA-2, GPM IMERG, GLDAS):

- Air temperature rises by about **+0.9 °C per decade**.
- Winter snow water fell by about **72%**.
- Rainfall shows **no clear trend**. The water is not falling less, it is evaporating faster.
- Root-zone soil moisture (10–40 cm) is down about **15%**.
- For Ukraine, the **North Atlantic Oscillation** explains much more of the year-to-year swings than El Niño. El Niño was not significant here, but it is for Australia.

These numbers will move a little once the cropland mask and the final trend tests are in. The method is described below.

## How it works

```
NASA / NOAA downloads → zone averages → statistics and model → files in data/ and results/
                                                                         │
                                                       FastAPI reads them (no math)
                                                                         │
                                                          Next.js site, UA / EN
```

We made one rule early on: **the API never calculates anything.** The pipeline writes files, and the API only reads, filters and combines them. If a number on the screen looks wrong, you can find the exact file and row it came from. It also let the people working on the statistics and the people working on the site work at the same time without blocking each other. The shared file formats are in [CONTRACTS.md](CONTRACTS.md).

### Data

| What | Product | From |
|---|---|---|
| Rainfall | GPM IMERG v07, monthly | NASA GES DISC |
| Temperature, air dryness | MERRA-2 | NASA GMAO |
| Soil moisture, evaporation, snow | GLDAS Noah 2.1 | NASA GES DISC |
| Field greenness (NDVI) | MODIS MOD13A3 v061 | NASA LP DAAC, via AppEEARS |
| Ground water storage | GRACE / GRACE-FO | NASA JPL |
| El Niño (ONI), NAO | indices | NOAA CPC |

Most of the series were pulled through NASA Giovanni. NDVI is not available in Giovanni, so it goes through AppEEARS.

Zones: three in Ukraine (the main Kakhovka irrigated area, southern Dnipropetrovsk, and a rainfed control in Mykolaiv) and two in Australia (Murrumbidgee, and a rainfed control near Temora). The control zones never had canal water. If our method finds a "water loss" effect there, the method is wrong.

### Statistics

- **Anomalies.** Each month is compared with the same calendar month in 2003–2021, so July is compared with other Julys. Otherwise the seasons hide everything else.
- **Trends.** We use Sen's slope with the modified Mann–Kendall test (Hamed–Rao), because monthly climate data is autocorrelated and the plain test gives too many false trends. We test many variables at once, so the p-values go through Benjamini–Hochberg correction.
- **Labels.** "Confirmed" means it passes after the correction. "Possible" means p < 0.2 before the correction. For weak trends we also show how many more years of data are needed (Weatherhead et al., 1998).
- **Expected vs actual.** A model trained on weather only, before June 2023, predicts what NDVI should be afterwards. The gap between that and the satellite reading is the part the weather doesn't explain.
- **Forecast.** 1, 3 and 6 months ahead, with an 80% range. We check it on years it hasn't seen, against two simple baselines: "same as now" and "normal for the month". The 6-month forecast is hidden unless it beats both.
- **Traffic light.** One rule everywhere: NDVI z-score above −0.5 is green, −1 to −0.5 is yellow, below −1 is red.

## Running it locally

You need Python 3.11+ and Node.js 20+.

```bash
# backend
cd backend
python -m pip install -r requirements.txt
python mock/make_mock.py                    # demo data; skip once real files exist
python -m uvicorn app.main:app --reload --port 8000
```

```bash
# frontend (second terminal)
cd frontend
npm install
cp .env.example .env.local                  # Windows: copy .env.example .env.local
npm run dev
```

Open http://localhost:3000. The interface is in Ukrainian by default; add `?lang=en` for English. The API docs are at http://localhost:8000/docs.

Tests: `cd backend && python -m pytest -q`

On Windows, if `uvicorn` or `streamlit` is "not recognized", run them as `python -m uvicorn ...`. The scripts folder is often not on PATH.

### Settings

| Variable | Default | What it does |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Where the frontend looks for the API |
| `FTG_DATA_ROOT` | repo root | Folder with `data/` and `results/` (the prefix is left over from the old name, Follow the Gas) |
| `CORS_ORIGINS` | `*` | Allowed frontend addresses, comma-separated |
| `ANTHROPIC_API_KEY` | not set | Turns on the AI assistant. Without it, the assistant answers from a template built from the same numbers |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model used by the assistant |

The assistant only gets the zone's computed results as context, not the open internet, and it has to cite the field behind each claim, for example `[trends temp]`.

### Main endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/zones/{zone}/now` | Traffic light, forecast, "why", tips, recent weather alerts |
| `GET /api/trends?zone=` | Trend table with corrected p-values |
| `GET /api/zones/{zone}/expected` | Expected vs actual NDVI |
| `GET /api/chain` | Lags between heat, rain, soil and NDVI |
| `GET /api/compare` | Ukraine vs Australia |
| `POST /api/assistant` | An answer to a question about a zone |
| `GET /api/download/{name}.csv` | Any result file as CSV |

The full list is at `/docs`. If a result file is missing, the endpoint returns an empty result and the page says "not published yet". It doesn't crash.

## What each file does

### Top level

| File / folder | What it is |
|---|---|
| `README.md` | This file |
| `CONTRACTS.md` | The agreed formats of every data and result file: columns, units, fixed zone and variable names. The pipeline and the app both follow it. Read it before you add or rename a column |
| `analysis.py` | Statistics for the real data: anomalies, Mann–Kendall trend test with Sen's slope, years until a trend becomes certain, lag correlations between variables |
| `regions.py` | List of variables (name, unit, NASA source) and regions. Add a region here once its CSV is in `data/` |
| `.gitignore` | Keeps `node_modules`, build folders, caches and `.env` files out of git |
| `docs/` | Screenshots used in this README |

### `backend/`: the API (Python, FastAPI)

| File | What it does |
|---|---|
| `requirements.txt` | Python packages to install |
| `app/main.py` | All API routes (`/api/...`), CORS settings, CSV downloads. Start point for uvicorn |
| `app/store.py` | Reads the files from `data/` and `results/`. Caches them until a file changes. A missing file returns nothing instead of crashing |
| `app/logic.py` | Turns the result files into what each page needs: traffic light, "why" chain, tips, Ukraine vs Australia comparison. The drought thresholds (−0.5 and −1) live **only here** |
| `app/assistant.py` | The AI assistant. Sends the zone's computed numbers to the Claude API and asks it to cite the field behind each claim. Without an API key it returns "offline" and the site shows a template answer |
| `app/__init__.py` | Empty; marks `app` as a Python package |
| `mock/make_mock.py` | Writes invented demo data in the final formats, so the app can be built before real results exist. Every row it writes is marked `source = MOCK`, which turns on the "Demo data" banner |
| `tests/test_api.py` | Checks that every endpoint answers and that missing files don't crash it. Run with `python -m pytest -q` |

### `frontend/`: the website (Next.js, TypeScript)

| File | What it does |
|---|---|
| `package.json`, `package-lock.json` | JavaScript packages and the `npm run dev` / `npm run build` commands. Run npm commands **inside `frontend/`** |
| `.env.example` | Template for `.env.local`: the backend address (`NEXT_PUBLIC_API_URL`) |
| `next.config.mjs`, `postcss.config.mjs`, `tsconfig.json`, `next-env.d.ts` | Settings for Next.js, CSS and TypeScript. Rarely need changes |
| `src/app/layout.tsx` | Frame of every page: page title, fonts, language and zone providers |
| `src/app/globals.css` | Colours, fonts and spacing for the whole site |
| `src/app/icon.svg` | Browser tab icon |
| `src/app/page.tsx` | **Fields now**: condition, traffic light, forecast, why, tips, weather alerts |
| `src/app/trends/page.tsx` | **Trends**: 20-year direction of each variable with "confirmed / possible / no clear change" |
| `src/app/chain/page.tsx` | **Drought chain**: how heat and rain pass to soil and crops, with delays |
| `src/app/expected/page.tsx` | **Expected vs actual**: weather-only model against the satellite reading |
| `src/app/compare/page.tsx` | **Ukraine vs Australia** |
| `src/app/assistant/page.tsx` | **Ask**: the AI assistant |
| `src/app/expert/page.tsx` | **Expert view**: any variable and period, full statistics, CSV downloads |
| `src/components/Shell.tsx` | Header, menu, language switch, demo-data banner |
| `src/components/ZonePicker.tsx` | Zone selector |
| `src/components/ZoneMap.tsx` | Small map with the study zones |
| `src/components/FieldStrip.tsx` | The coloured strip of months showing field condition |
| `src/components/TimeChart.tsx` | Line chart over time with event markers (for example, the dam destruction) |
| `src/components/NowParts.tsx` | Blocks of the main page: why chain, tips, alerts, data dates |
| `src/components/bits.tsx` | Small shared pieces: loading/error message, traffic-light tag, page and section headings |
| `src/lib/api.ts` | Talks to the backend; data types for every response |
| `src/lib/i18n.tsx` | Language switching (Ukrainian / English) |
| `src/lib/zone.tsx` | Remembers which zone is selected across pages |
| `src/lib/format.ts` | Number and date formatting, traffic-light colours |
| `src/i18n/uk.json`, `src/i18n/en.json` | **Every word shown on the site.** To change a text or add a language, edit these, not the pages |

### `data/`: inputs

| File | What's in it |
|---|---|
| `ukraine.csv` | Real monthly series for southern Ukraine, 2003–2025: temperature, rainfall, soil moisture at two depths, evaporation, snow, NAO and ONI indices |
| `processed/all_series.parquet` | All monthly series for all zones in one table: zone, variable, date, value, unit, source |
| `zones.csv` | Study zones: names in both languages, centre point and borders |
| `events.csv` | Events marked on charts (dam destruction, droughts) |
| `sources.csv` | Which NASA/NOAA product each variable comes from, with links |
| `data_dates.csv` | Last available month for each data source |
| `tips_rules.csv` | Which tip is shown for which signal, and in what order |

### `results/`: outputs of the statistics and the model

| File | What's in it |
|---|---|
| `trends.csv` | Trend per zone and variable: slope per decade, p-values before and after correction, label, years to certainty |
| `lags.csv` | Delay and strength of each link in the drought chain (for example rain → soil moisture) |
| `expected_vs_actual.parquet` | Monthly NDVI the weather-only model expected, the satellite reading, and the gap |
| `forecast.parquet` | Forecast 1, 3 and 6 months ahead with an 80% range |
| `model_skill.csv` | How accurate the forecast is compared with simple guesses |
| `feature_importance.csv` | Which variables matter most for each country |
| `alerts.csv` | Recent dry spells, heat days, frost, heavy rain |
| `summary.csv` | Headline numbers for the comparison page: size of the hit, recovery time, chain delay |

Whether a file holds real or demo data: open it and check the `source` column, or look for the "Demo data" banner on the site.

## What it can't do

- **It can't prove causes.** When two series move together, that doesn't mean one causes the other. The control zones help, but they are not an experiment.
- **No cropland mask yet.** Zone averages include villages, roads and pasture, not only fields.
- **It works at area level, not field level.** Some products have 25–50 km cells, so this is not a precision-farming app and doesn't try to be one.
- **The data lags.** Monthly products arrive 1–2 months late, and the newest rainfall values are early estimates.
- **The war affects NDVI directly.** Mined, shelled and abandoned fields lose greenness whatever the weather. We can't fully separate that from water loss.
- **About 23 years is a short record** for confirming slow trends.

## Next

The work in order: put the real data in place of the demo files, then the Australia series, the NDVI cropland mask, and the model. After that: a month slider to replay any month since 2003, and a Telegram message when a zone's traffic light changes.

## Team

<!-- Fill in before publishing: names and who did what -->

## License

<!-- Not chosen yet. Add a LICENSE file (for example MIT) before the repo goes public. -->
NASA and NOAA data are used under their open data policies.

## Thanks

NASA GES DISC, LP DAAC and JPL for the data, and the Giovanni and AppEEARS teams for tools that let students get it without writing a downloader. NOAA CPC for the ONI and NAO indices. Map outlines come from Natural Earth.
