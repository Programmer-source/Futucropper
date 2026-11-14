"""Region and feature definitions. Add a region here once its CSV is in data/."""

FEATURES = {
    "temp_C":          {"label": "Air temperature",           "unit": "°C",            "source": "MERRA-2 (M2TMNXSLV T2M)"},
    "precip_mm_day":   {"label": "Rainfall",                  "unit": "mm/day",        "source": "GPM IMERG monthly (GPM_3IMERGM v07)"},
    "evap_mm_day":     {"label": "Evapotranspiration",        "unit": "mm/day",        "source": "GLDAS Noah 2.1 (Evap_tavg)"},
    "snow_swe_kg_m2":  {"label": "Snow (water equivalent)",   "unit": "kg/m²",         "source": "GLDAS Noah 2.1 (SWE_inst)"},
    "soil0_10_kg_m2":  {"label": "Topsoil moisture 0–10 cm",  "unit": "kg/m²",         "source": "GLDAS Noah 2.1 (SoilMoi0_10cm)"},
    "soil10_40_kg_m2": {"label": "Root-zone moisture 10–40 cm", "unit": "kg/m²",       "source": "GLDAS Noah 2.1 (SoilMoi10_40cm)"},
    "NAO":             {"label": "North Atlantic Oscillation", "unit": "index",        "source": "NOAA CPC"},
    "ONI":             {"label": "El Niño index (ONI)",       "unit": "°C",            "source": "NOAA CPC"},
}

REGIONS = {
    "Southern Ukraine": {
        "file": "data/ukraine.csv",
        "bbox": (30, 46, 38, 49),  # west, south, east, north
        "center": (47.5, 34.0),
        "question": "Why is southern Ukraine getting drier?",
        "note": "The Kakhovka dam (≈33.4°E, 46.8°N) was destroyed in June 2023 and the war affects "
                "farming since 2022, so 2022–2025 changes are not only climate.",
        # Trends shown on the overview: (column, months or None for whole year, label)
        "trends": [
            ("temp_C", None, "Air temperature (year)"),
            ("snow_swe_kg_m2", [12, 1, 2, 3], "Winter snow (Dec–Mar)"),
            ("precip_mm_day", None, "Rainfall (year)"),
            ("evap_mm_day", None, "Evapotranspiration (year)"),
            ("soil0_10_kg_m2", [7, 8, 9], "Topsoil moisture (Jul–Sep)"),
            ("soil10_40_kg_m2", None, "Root-zone moisture (year)"),
        ],
        # Chain links: (driver, response, months or None, max_lag)
        "links": [
            ("NAO", "precip_mm_day", [12, 1, 2], 0),
            ("ONI", "precip_mm_day", None, 6),
            ("temp_C", "snow_swe_kg_m2", None, 0),
            ("temp_C", "soil0_10_kg_m2", None, 3),
            ("snow_swe_kg_m2", "soil0_10_kg_m2", None, 3),
            ("precip_mm_day", "soil0_10_kg_m2", None, 3),
            ("precip_mm_day", "evap_mm_day", None, 3),
            ("soil0_10_kg_m2", "soil10_40_kg_m2", None, 3),
        ],
    },
    # "Kalimantan (Indonesia)": {...}  -> add when data/indonesia.csv exists
}
