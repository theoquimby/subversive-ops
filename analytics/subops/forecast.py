"""Daily sales forecast with honest ranges.

Two statistical models are fitted on log sales of open days, with planned event
impact taken out first (so a festival doesn't inflate "a usual Saturday"):

- SARIMAX(1,0,0) with weekday dummies, a wet-day flag, max temperature and a
  trend as regressors (statsmodels state-space; 80% intervals from the model's
  forecast variance, back-transformed from logs);
- additive Holt-Winters (ETS) over the open-day sequence (one season = one
  week of open days), with intervals from its backtest errors.

Each is backtested the same way as the app's existing forecaster — every past
day forecast from history strictly before it — and the one with the lowest
average % error wins. If the existing forecaster is better, we say so and only
borrow the range width.
"""

from __future__ import annotations

import math
import time
import warnings

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX

from .common import WEEKDAYS, confidence, d, inp, insight, money, pct, weekday

Z80 = stats.norm.ppf(0.9)


def _frame(days: list[dict]) -> pd.DataFrame:
    rows = []
    for x in days:
        if not x.get("open") or (x.get("sales") or 0) <= 0:
            continue
        mult = x.get("eventMult") or 1.0
        if mult <= 0:
            continue
        rows.append({"date": x["date"], "sales": float(x["sales"]), "mult": float(mult), "wet": 1.0 if x.get("wet") else 0.0, "temp": x.get("tempMaxC")})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["y"] = np.log(df["sales"] / df["mult"])
    df["wd"] = [weekday(s) for s in df["date"]]
    return df.reset_index(drop=True)


def _exog(df: pd.DataFrame, weekdays: list[int], temp_mean: float, t0: str) -> pd.DataFrame:
    X = pd.DataFrame(index=df.index)
    X["const"] = 1.0
    for w in weekdays[1:]:
        X[f"wd{w}"] = (df["wd"] == w).astype(float)
    X["wet"] = df["wet"].astype(float)
    temp = pd.to_numeric(df["temp"], errors="coerce").fillna(temp_mean)
    X["temp"] = (temp - temp_mean) / 10.0
    X["trend"] = [(d(s) - d(t0)).days / 30.0 for s in df["date"]]
    return X


class SarimaxModel:
    name = "SARIMAX"

    def fit(self, train: pd.DataFrame):
        self.weekdays = sorted(train["wd"].unique().tolist())
        self.temp_mean = float(pd.to_numeric(train["temp"], errors="coerce").mean()) if train["temp"].notna().any() else 15.0
        self.t0 = train["date"].iloc[0]
        X = _exog(train, self.weekdays, self.temp_mean, self.t0)
        X = X.loc[:, X.std() > 0].assign(const=1.0) if len(X) > 1 else X
        self.cols = list(X.columns)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.res = SARIMAX(train["y"].values, exog=X.values, order=(1, 0, 0), trend="n").fit(disp=False, maxiter=200)
        return self

    def update(self, train: pd.DataFrame):
        """Same parameters, history extended (fast — no re-estimation)."""
        X = _exog(train, self.weekdays, self.temp_mean, self.t0).reindex(columns=self.cols, fill_value=0.0)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.res = self.res.apply(train["y"].values, exog=X.values)
        return self

    def predict(self, future: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        X = _exog(future, self.weekdays, self.temp_mean, self.t0).reindex(columns=self.cols, fill_value=0.0)
        f = self.res.get_forecast(steps=len(future), exog=X.values)
        return np.asarray(f.predicted_mean), np.sqrt(np.asarray(f.var_pred_mean))


class EtsModel:
    name = "Holt-Winters"

    def fit(self, train: pd.DataFrame):
        self.period = max(2, len(set(train["wd"])))
        self.last_wd_seq = train["wd"].tolist()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.res = ExponentialSmoothing(train["y"].values, trend="add", damped_trend=True, seasonal="add", seasonal_periods=self.period, initialization_method="estimated").fit()
        self.sigma = float(np.std(self.res.resid)) if len(train) > 3 else 0.2
        return self

    def update(self, train: pd.DataFrame):
        """Same smoothing parameters on the longer history (fast)."""
        p = self.res.params
        fixed = {k: p[k] for k in ("smoothing_level", "smoothing_trend", "smoothing_seasonal", "damping_trend") if p.get(k) is not None and np.isfinite(p[k])}
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.res = ExponentialSmoothing(train["y"].values, trend="add", damped_trend=True, seasonal="add", seasonal_periods=self.period, initialization_method="heuristic").fit(optimized=False, **fixed)
        self.sigma = float(np.std(self.res.resid))
        return self

    def predict(self, future: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        # The open-day sequence is regular (same closed weekday each week), so step h is just h open days ahead.
        steps = len(future)
        mean = np.asarray(self.res.forecast(steps))
        sd = self.sigma * np.sqrt(1 + 0.15 * np.arange(1, steps + 1))
        return mean, sd


def backtest(df: pd.DataFrame, model_cls, n_test: int, refit_every: int = 7) -> list[dict]:
    """Day-before forecasts for the last n_test open days. Parameters are re-estimated weekly;
    in between, the fitted model is just fed the extra days (as it would be in real use)."""
    out = []
    m = None
    for k, i in enumerate(range(len(df) - n_test, len(df))):
        train, test = df.iloc[:i], df.iloc[i : i + 1]
        try:
            m = model_cls().fit(train) if (m is None or k % refit_every == 0) else m.update(train)
            mu, sd = m.predict(test)
        except Exception:
            m = None
            continue
        mult = float(test["mult"].iloc[0])
        f = math.exp(mu[0]) * mult
        lo, hi = math.exp(mu[0] - Z80 * sd[0]) * mult, math.exp(mu[0] + Z80 * sd[0]) * mult
        a = float(test["sales"].iloc[0])
        out.append({"date": test["date"].iloc[0], "forecast": f, "low": lo, "high": hi, "actual": a, "error": (f - a) / a})
    return out


def mape(rows: list[dict]) -> float | None:
    e = [abs(r["error"]) for r in rows if r.get("error") is not None]
    return float(np.mean(e)) if e else None


def run(data: dict) -> dict:
    t_start = time.time()
    df = _frame(data.get("days", []))
    future = data.get("future", [])
    if len(df) < 21:
        return insight("forecast", "Forecast ranges", status="thin", headline="Needs 3+ weeks of sales to give ranges.", action="Keep Square syncing; ranges appear after 3 weeks.", how=["A range needs enough history to see how much days wobble."], confidence={"level": "low", "score": 0.1, "note": f"Based on {len(df)} days — not enough"})
    n_test = int(min(28, max(7, len(df) - 28)))
    candidates = {}
    for cls in (SarimaxModel, EtsModel):
        rows = backtest(df, cls, n_test)
        if rows:
            candidates[cls.name] = {"cls": cls, "rows": rows, "mape": mape(rows), "coverage": float(np.mean([r["low"] <= r["actual"] <= r["high"] for r in rows]))}
    ts_rows = [r for r in data.get("tsBacktest", []) if r.get("actual") and r["actual"] > 0 and r["date"] in set(df["date"].iloc[-n_test:])]
    ts_mape = float(np.mean([abs(r["forecast"] - r["actual"]) / r["actual"] for r in ts_rows])) if ts_rows else None
    if not candidates:
        return insight("forecast", "Forecast ranges", status="thin", headline="The statistical models couldn't be fitted yet.", action="Nothing to do — try again after another week of sales.", how=[])
    best_name = min(candidates, key=lambda k: candidates[k]["mape"] or 9)
    best = candidates[best_name]
    model = best["cls"]().fit(df)

    # Future open days, in order (closures and known closed weekdays get no range).
    open_wds = set(df["wd"].iloc[-28:])
    fut_rows = []
    for x in future:
        closed = bool(x.get("closure")) or (x.get("eventMult") == 0) or weekday(x["date"]) not in open_wds
        fut_rows.append({**x, "closed": closed})
    fo = [x for x in fut_rows if not x["closed"]]
    fdf = pd.DataFrame([{"date": x["date"], "wd": weekday(x["date"]), "wet": 1.0 if x.get("wet") else 0.0, "temp": x.get("tempMaxC"), "mult": float(x.get("eventMult") or 1.0)} for x in fo])
    ranges = {}
    if len(fdf):
        mu, sd = model.predict(fdf)
        # Widen to what the backtest actually saw if the model's own band was too narrow.
        cov = best["coverage"]
        widen = 1.0 if cov >= 0.75 else 1.0 + (0.8 - cov) * 2.5
        for i, x in enumerate(fo):
            m = float(fdf["mult"].iloc[i])
            ranges[x["date"]] = {"mid": math.exp(mu[i]) * m, "low": math.exp(mu[i] - Z80 * sd[i] * widen) * m, "high": math.exp(mu[i] + Z80 * sd[i] * widen) * m}
    out_days = []
    for x in fut_rows:
        r = ranges.get(x["date"])
        ts = x.get("tsForecast")
        if r and ts_mape is not None and best["mape"] is not None and ts_mape < best["mape"] and ts:
            # The existing forecaster is more accurate: centre on it, keep our width.
            ratio_lo, ratio_hi = r["low"] / r["mid"], r["high"] / r["mid"]
            r = {"mid": ts, "low": ts * ratio_lo, "high": ts * ratio_hi}
        out_days.append({"date": x["date"], "closed": x["closed"] or r is None, "mid": round(r["mid"], 0) if r else 0, "low": round(r["low"], 0) if r else 0, "high": round(r["high"], 0) if r else 0, "ts": ts, "events": x.get("eventTitles") or []})
    week = [x for x in out_days[:7] if not x["closed"]]
    total_mid = sum(x["mid"] for x in out_days[:7])
    # Weekly range: daily errors are partly correlated, so add in quadrature and blend with the straight sum.
    var = sum(((x["high"] - x["low"]) / (2 * Z80)) ** 2 for x in week)
    straight = sum(x["high"] - x["mid"] for x in week)
    half = 0.5 * (math.sqrt(var) * Z80) + 0.5 * straight
    busiest = max(week, key=lambda x: x["mid"]) if week else None
    new_better = ts_mape is None or (best["mape"] is not None and best["mape"] <= ts_mape)
    if busiest:
        headline = f"Next 7 days: about {money(total_mid)} ({money(total_mid - half)}–{money(total_mid + half)}). Busiest: {WEEKDAYS[weekday(busiest['date'])]} {money(busiest['low'])}–{money(busiest['high'])}"
    else:
        headline = "Closed all of the next 7 days."
    if ts_mape is not None:
        compare = f"{best_name} was off by {pct(best['mape'], 1)} on a typical day vs {pct(ts_mape, 1)} for the current forecast"
        action = f"Use the ranges: staff and prep for the middle, have a call-in ready above it. ({compare}.)" if new_better else f"Keep the current forecast — it was more accurate ({pct(ts_mape, 1)} vs {pct(best['mape'], 1)}); use these ranges for how far a day can swing."
    else:
        compare = f"{best_name} was off by {pct(best['mape'])} on a typical day"
        action = "Use the ranges: staff and prep for the middle, have a call-in ready above it."
    conf = confidence(len(df), 0.0 if best["coverage"] >= 0.7 else 0.1)
    how = [
        f"We fitted two statistical models to {len(df)} open days of sales: {', '.join(candidates)}. Planned events (festivals, games, music) were divided out first using their expected impact, and put back for future days.",
        f"Each model forecast the last {n_test} open days one at a time, using only the history before each day — the same test the current forecast gets. {compare}.",
        f"The 80% range means 4 days in 5 should land inside it. In that test, {round(best['coverage'] * len(best['rows']))} of {len(best['rows'])} actual days did{' (we widened the ranges to match)' if best['coverage'] < 0.75 else ''}.",
        "Rain and temperature count when the weather forecast has them; manual adjustments and events on the Sales page carry through.",
    ]
    inputs = [inp("Open days of history", len(df)), inp("Backtest days", n_test)] + [inp(f"{k} typical error", pct(v["mape"], 1)) for k, v in candidates.items()]
    if ts_mape is not None:
        inputs.append(inp("Current forecast typical error", pct(ts_mape, 1)))
    inputs.append(inp("Range coverage in backtest", pct(best["coverage"])))
    return insight(
        "forecast",
        "Forecast ranges",
        headline=headline,
        action=action,
        confidence=conf,
        how=how,
        inputs=inputs,
        chart={"type": "band", "rows": [{"date": x["date"], "mid": x["mid"], "low": x["low"], "high": x["high"], "closed": x["closed"]} for x in out_days], "history": [{"date": r["date"], "actual": round(r["actual"], 0), "forecast": round(r["forecast"], 0)} for r in best["rows"]]},
        details={"days": out_days, "model": best_name, "mape": best["mape"], "tsMape": ts_mape, "coverage": best["coverage"], "newBetter": new_better, "week": {"mid": total_mid, "low": total_mid - half, "high": total_mid + half}, "seconds": round(time.time() - t_start, 2), "models": {k: {"mape": v["mape"], "coverage": v["coverage"]} for k, v in candidates.items()}},
    )
