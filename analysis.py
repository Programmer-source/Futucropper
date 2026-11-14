"""Core statistics for Follow the Gas. Used by the Streamlit app and by notebooks."""
import numpy as np
import pandas as pd
import pymannkendall as mk
from scipy.stats import norm

# Indices that are already anomalies (no seasonal cycle to remove)
INDEX_COLS = {"NAO", "ONI"}


def load_region(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    df.index.name = "month"
    return df


def anomalies(df: pd.DataFrame) -> pd.DataFrame:
    """Subtract each calendar month's average, so the seasonal cycle is removed."""
    out = df.copy()
    for c in df.columns:
        if c not in INDEX_COLS:
            out[c] = df[c] - df[c].groupby(df.index.month).transform("mean")
    return out


def seasonal_subset(s: pd.Series, months) -> pd.Series:
    """Yearly mean over the chosen months. Dec is counted with the following winter."""
    sub = s[s.index.month.isin(months)]
    year = sub.index.year + ((sub.index.month == 12) & (12 in months) & (1 in months))
    return sub.groupby(year).mean()


def trend(y: pd.Series) -> dict:
    """Mann-Kendall test + Sen's slope on a yearly series."""
    y = y.dropna()
    r = mk.original_test(y)
    first, last = y.iloc[:5].mean(), y.iloc[-5:].mean()
    return {
        "trend": r.trend,
        "p": r.p,
        "significant": r.p < 0.05,
        "slope_per_decade": r.slope * 10,
        "first5": first,
        "last5": last,
        "change_pct": (last - first) / abs(first) * 100 if first else np.nan,
        "years": f"{y.index.min()}–{y.index.max()}",
    }


def years_to_emergence(y: pd.Series) -> float:
    """Weatherhead et al. (1998): years of data needed to detect the current trend."""
    y = y.dropna()
    t = np.arange(len(y))
    slope, intercept = np.polyfit(t, y.values, 1)
    resid = y.values - (slope * t + intercept)
    sigma = resid.std(ddof=1)
    phi = pd.Series(resid).autocorr(1)
    phi = 0 if np.isnan(phi) else max(min(phi, 0.95), -0.95)
    if slope == 0:
        return np.inf
    return float((3.3 * sigma / abs(slope) * np.sqrt((1 + phi) / (1 - phi))) ** (2 / 3))


def lag_profile(anom: pd.DataFrame, driver: str, response: str, max_lag: int = 12) -> pd.DataFrame:
    """Correlation of driver(t) with response(t+k) for k = 0..max_lag."""
    rows = []
    for k in range(max_lag + 1):
        pair = pd.concat([anom[driver], anom[response].shift(-k)], axis=1).dropna()
        n = len(pair)
        r = pair.iloc[:, 0].corr(pair.iloc[:, 1])
        z = np.arctanh(np.clip(r, -0.999, 0.999)) * np.sqrt(max(n - 3, 1))
        rows.append({"lag": k, "r": r, "p": 2 * (1 - norm.cdf(abs(z))), "n": n})
    return pd.DataFrame(rows)


def _corr_p(x: pd.Series, y: pd.Series):
    pair = pd.concat([x, y], axis=1).dropna()
    n = len(pair)
    r = pair.iloc[:, 0].corr(pair.iloc[:, 1])
    z = np.arctanh(np.clip(r, -0.999, 0.999)) * np.sqrt(max(n - 3, 1))
    return r, 2 * (1 - norm.cdf(abs(z))), n


def best_link(anom, driver, response, max_lag=6, months=None) -> dict:
    """Strongest lagged link. With `months`, only same-month pairs inside that season."""
    if months is not None:
        a = anom[anom.index.month.isin(months)]
        r, p, n = _corr_p(a[driver], a[response])
        return {"lag": 0, "r": r, "p": p, "n": n}
    prof = lag_profile(anom, driver, response, max_lag)
    return prof.loc[prof["r"].abs().idxmax()].to_dict()


def strength_label(r: float) -> str:
    a = abs(r)
    return "strong" if a >= 0.5 else "moderate" if a >= 0.3 else "weak" if a >= 0.1 else "none"
