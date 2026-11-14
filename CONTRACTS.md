# Data contracts

The pipeline (data + model team) writes these files. The API only reads, filters and combines them; it never
recalculates results. A missing file never crashes anything: the page shows "fills in when the team publishes".
`backend/mock/make_mock.py` writes invented files in exactly these formats (every series row has `source = MOCK`).

Paths are relative to the repo root. Dates are ISO `YYYY-MM-DD`; monthly values use the first day of the month.

## Fixed values (agree before changing)
- `country`: `UA`, `AU` (`ALL` allowed in events)
- `zone`: `UA_main`, `UA_second`, `UA_control`, `AU_main`, `AU_control`
- `zone_type`: `irrigated`, `control`
- variables: `ndvi, ndvi_z, ndvi_pct_normal, precip, precip_z, soil_moisture, soil_moisture_z, evap, vpd, vpd_z, temp, temp_z, heat_days_30, dry_spell_max, oni` (`grace_tws` is reserved; no GRACE data is used yet; `oni` holds the monthly Niño-3.4 anomaly)
  (`*_z` = anomaly vs the 2003–2021 mean and SD for the same calendar month)
- Each variable and unit needs a label in `frontend/src/i18n/uk.json` and `en.json` (`var.<name>`, `unit.<unit>`).

## Traffic light (one rule, in `backend/app/logic.py`)
Field greenness z-score: `> −0.5` green · `−1 … −0.5` yellow · `< −1` red. Used for "now" and for the forecast.

## Files

| File | Owner | Columns |
|---|---|---|
| data/processed/all_series.parquet | data | zone, country, zone_type, variable, date, value, unit, source |
| data/zones.csv | data | zone, country, zone_type, name_uk, name_en, lat, lon, west, south, east, north |
| data/events.csv | data + AU part | country, start, end, type, label_uk, label_en |
| data/data_dates.csv | pipeline (auto) | variable, product, last_date, cadence |
| data/sources.csv | data | variable, product, provider, url |
| data/tips_rules.csv | team (reviewed) | signal, tip, priority |
| results/trends.csv | model | zone, variable, season, slope_per_decade, ci_low, ci_high, p_value, p_value_fdr, significant, badge, years_to_significance, unit |
| results/lags.csv | model | country, from_var, to_var, lag_months, corr, p_value_fdr, significant |
| results/expected_vs_actual.parquet | model | zone, date, actual, expected, expected_low, expected_high, gap, gap_pct |
| results/forecast.parquet | model | zone, issue_date, target_date, lead_months (1, 3, 6), predicted (ndvi_z), low, high (80% band), beats_baseline |
| results/model_skill.csv | model | zone, country, horizon, model, rmse, rmse_persistence, rmse_climatology, class_accuracy, drought_hit_rate, coverage80, r2 |
| results/feature_importance.csv | model | country, feature, importance, rank |
| results/alerts.csv | pipeline (8-day) | zone, period_start, period_end, type, value, unit, percentile, active |
| results/summary.csv | model | country, metric, value, unit — metrics: water_loss_effect_pct, hit_depth_pct, recovery_months (empty = not recovered), chain_lag_months |

### Notes
- `badge`: `confirmed` (p_value_fdr < 0.05), `possible` (not confirmed, p_value < 0.10, the model team's rule), `none`.
- `tips_rules.signal` values the API emits: `drought_red, drought_yellow, dry_soil, dry_spell, heat30, heat35, frost, heavy_rain, el_nino_au, normal`.
  `tip` keys must exist as `tip.<key>` in both translation files.
- `alerts.type`: `dry_spell, heat30, heat35, frost, heavy_rain`; `active = true` when unusual for the time of year.
- 6-month forecast is shown only when `beats_baseline = true`.
- `forecast.parquet` may also have `light_model` (green / yellow / red from the model team's drought-class model) and
  `prob_red, prob_yellow, prob_green`; when present the API uses `light_model` for the forecast light.
- `alerts.type` may also be `dry_spell_next8d`: the model's probability (`value`, %) of an unusual dry spell in the next 8 days.
- Every results file may carry extra explanation columns (e.g. `definition`, `method`, `out_of_sample`); the app ignores them.
