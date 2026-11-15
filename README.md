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

## Repository

```
backend/app/       API: main.py (routes), store.py (file reading), logic.py (traffic light, tips),
                   assistant.py
backend/mock/      demo data generator
frontend/src/      Next.js pages, components, i18n/uk.json + en.json (all visible text lives here)
data/, results/    pipeline output (demo for now)
analysis.py        statistics for the real Ukraine dataset (prototype from the Streamlit version)
CONTRACTS.md       file formats
```

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
