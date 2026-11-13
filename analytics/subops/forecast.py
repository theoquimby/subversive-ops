"""Daily sales forecast with honest ranges.

Two simple, fast models are fitted on log sales of open days, with planned event
impact divided out first (so a festival doesn't inflate "a usual Saturday"):

- "Seasonal pattern": a regression on weekday, time of year (smooth yearly
  waves, so multi-year history teaches it that January is slow), a gentle trend,
  and rain/temperature when the weather history covers it — plus a local level
  (how the last few weeks ran against the pattern), so a slow autumn shows up;
- "Recent weeks": the median of the same weekday over the last 4 weeks.

Each is backtested the way it's used — every past day forecast only from the
days before it — and the one with the smaller typical miss (total error ÷
total sales) wins. The app's own forecast is compared on the same days.

Ranges come from the backtest itself: the 10th–90th percentile of how far real
days landed from the forecast, so "4 days in 5 land inside" is true by
construction rather than a model's promise. Closed days (stray sales on a
closed day, closed weekdays, closures) are never forecast.
"""

from __future__ import annotations

import math
import time

import numpy as np
import pandas as pd

from .common import WEEKDAYS, confidence, d, inp, insight, money, pct, weekday, weeks_label

MAX_TRAIN_DAYS = 3 * 365  # older years teach seasonality but the business has changed; 3 years is plenty
LEVEL_HALF_LIFE = 10  # open days


def _frame(days: list[dict]) -> pd.DataFrame:
    rows = []
    for x in days:
        if not x.get("open") or (x.get("sales") or 0) <= 0:
            continue
        mult = x.get("eventMult") or 1.0
        if mult <= 0:
            continue
        rows.append({"date": x["date"], "sales": float(x["sales"]), "mult": float(mult), "wet": 1.0 if x.get("wet") else 0.0, "temp": x.get("tempMaxC"), "hasWeather": bool(x.get("hasWeather"))})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["y"] = np.log(df["sales"] / df["mult"])
    df["wd"] = [weekday(s) for s in df["date"]]
    df["t"] = [(d(s) - d(df["date"].iloc[0])).days / 365.25 for s in df["date"]]
    df["doy"] = [d(s).timetuple().tm_yday for s in df["date"]]
    return df.reset_index(drop=True)


class Seasonal:
    name = "Seasonal pattern"

    def fit(self, train: pd.DataFrame):
        train = train.iloc[-MAX_TRAIN_DAYS:]
        self.weekdays = sorted(train["wd"].unique().tolist())
        span = train["t"].iloc[-1] - train["t"].iloc[0]
        self.k = 3 if span >= 1.5 else 2 if span >= 0.9 else 0  # yearly waves only once a year has been seen
        self.weather = bool(train["hasWeather"].mean() >= 0.6)
        self.temp_mean = float(pd.to_numeric(train["temp"], errors="coerce").mean()) if self.weather else 15.0
        if not math.isfinite(self.temp_mean):
            self.temp_mean = 15.0
        self.t0 = float(train["t"].iloc[0])
        X = self._x(train)
        y = train["y"].values
        # Recent days count more (half-weight at ~1 year) so the pattern follows how the place runs now.
        age = train["t"].iloc[-1] - train["t"].values
        w = np.sqrt(0.5 ** (age / 1.0))
        self.beta, *_ = np.linalg.lstsq(X * w[:, None], y * w, rcond=None)
        self._set_level(train, y - X @ self.beta)
        return self

    def _set_level(self, train: pd.DataFrame, resid: np.ndarray):
        """How the last few weeks ran against the pattern: overall, and per weekday (a busy run of
        Saturdays doesn't mean busy Mondays). Partial, so a slow fortnight isn't the new normal."""
        tail, wds = resid[-90:], train["wd"].values[-90:]
        if len(tail) == 0:
            self.level, self.wd_level = 0.0, {}
            return
        wts = 0.5 ** (np.arange(len(tail))[::-1] / LEVEL_HALF_LIFE)
        self.level = float(np.sum(tail * wts) / np.sum(wts)) * 0.7
        self.wd_level = {}
        for wd in set(wds.tolist()):
            r = tail[wds == wd][-6:]
            if len(r):
                ww = 0.6 ** np.arange(len(r))[::-1]
                self.wd_level[wd] = float(np.sum(r * ww) / np.sum(ww)) * len(r) / (len(r) + 3)

    def _x(self, df: pd.DataFrame) -> np.ndarray:
        cols = [np.ones(len(df))]
        for w in self.weekdays[1:]:
            cols.append((df["wd"].values == w).astype(float))
        trend = np.clip(df["t"].values - self.t0, 0, None)
        cols.append(trend)
        weekend = np.isin(df["wd"].values, [4, 5, 6]).astype(float)
        for k in range(1, self.k + 1):
            ang = 2 * math.pi * k * df["doy"].values / 365.25
            cols += [np.sin(ang), np.cos(ang)]
            if k <= 2:  # weekends swing with the seasons more than weeknights (leaf-peeping Saturdays)
                cols += [weekend * np.sin(ang), weekend * np.cos(ang)]
        if self.weather:
            cols.append(df["wet"].values.astype(float))
            temp = pd.to_numeric(df["temp"], errors="coerce").fillna(self.temp_mean).values
            cols.append((temp - self.temp_mean) / 10.0)
        return np.column_stack(cols)

    def update(self, train: pd.DataFrame):
        t = train.iloc[-120:]
        self._set_level(t, t["y"].values - self._x(t) @ self.beta)
        return self

    def predict(self, future: pd.DataFrame) -> np.ndarray:
        lv = np.array([self.level * 0.5 + self.wd_level.get(wd, self.level) * 0.5 if wd in self.wd_level else self.level for wd in future["wd"].values])
        return self._x(future) @ self.beta + lv


class RecentWeeks:
    name = "Recent weeks"

    def fit(self, train: pd.DataFrame):
        self.train = train.iloc[-90:]
        self.fallback = float(np.median(self.train["y"].values)) if len(self.train) else 0.0
        return self

    update = fit

    def predict(self, future: pd.DataFrame) -> np.ndarray:
        out = []
        for wd in future["wd"].values:
            same = self.train[self.train["wd"] == wd]["y"].values[-4:]
            out.append(float(np.median(same)) if len(same) else self.fallback)
        return np.array(out)


def backtest(df: pd.DataFrame, model_cls, n_test: int, refit_every: int = 14) -> list[dict]:
    """Day-before forecasts for the last n_test open days (refit every two weeks; in between the
    model just sees the extra days, as it would in real use)."""
    out = []
    m = None
    for k, i in enumerate(range(len(df) - n_test, len(df))):
        train, test = df.iloc[:i], df.iloc[i : i + 1]
        try:
            m = model_cls().fit(train) if (m is None or k % refit_every == 0) else m.update(train)
            mu = float(m.predict(test)[0])
        except Exception:  # noqa: BLE001
            m = None
            continue
        mult = float(test["mult"].iloc[0])
        f = math.exp(mu) * mult
        a = float(test["sales"].iloc[0])
        out.append({"date": test["date"].iloc[0], "forecast": f, "actual": a, "logErr": math.log(a / f), "error": (f - a) / a})
    return out


def wape(rows: list[dict]) -> float | None:
    """Typical miss: total absolute error ÷ total sales (a $300 day can't dominate like a % average lets it)."""
    a = sum(r["actual"] for r in rows)
    return float(sum(abs(r["forecast"] - r["actual"]) for r in rows) / a) if rows and a > 0 else None


# Kept for callers that imported it.
mape = wape


def run(data: dict) -> dict:
    t_start = time.time()
    df = _frame(data.get("days", []))
    future = data.get("future", [])
    closed_wd = set(data.get("closedWeekdays") or [])
    if len(df) < 21:
        return insight("forecast", "Sales forecast", status="thin", headline="Needs 3 weeks of sales to give ranges.", action="Keep Square connected — ranges appear after 3 weeks of sales.", how=["A range needs enough history to see how much days wobble."], confidence={"level": "low", "score": 0.1, "note": f"Based on {len(df)} days — not enough"})
    n_test = int(min(84, max(14, len(df) - 42)))
    candidates = {}
    for cls in (Seasonal, RecentWeeks):
        rows = backtest(df, cls, n_test)
        if rows:
            candidates[cls.name] = {"cls": cls, "rows": rows, "wape": wape(rows)}
    if not candidates:
        return insight("forecast", "Sales forecast", status="thin", headline="The forecast couldn't be worked out yet.", action="Nothing to do — it tries again after another week of sales.", how=[])
    best_name = min(candidates, key=lambda k: candidates[k]["wape"] if candidates[k]["wape"] is not None else 9)
    best = candidates[best_name]
    test_dates = {r["date"] for r in best["rows"]}
    ts_rows = [r for r in data.get("tsBacktest", []) if r.get("actual") and r["actual"] > 0 and r.get("forecast") and r["date"] in test_dates]
    ts_wape = wape([{"forecast": r["forecast"], "actual": r["actual"]} for r in ts_rows]) if len(ts_rows) >= 7 else None

    # Ranges from what really happened in the backtest (10th–90th percentile of the miss, in logs).
    errs = np.array([r["logErr"] for r in best["rows"]])
    lo_q, hi_q = (float(np.quantile(errs, 0.1)), float(np.quantile(errs, 0.9))) if len(errs) >= 20 else (-1.28 * float(np.std(errs)), 1.28 * float(np.std(errs)))
    lo_q, hi_q = min(lo_q, -0.05), max(hi_q, 0.05)
    coverage = float(np.mean([(lo_q <= e <= hi_q) for e in errs])) if len(errs) else 0.0

    model = best["cls"]().fit(df)
    fut_rows = []
    t_last = float(df["t"].iloc[-1])
    last_date = d(df["date"].iloc[-1])
    for x in future:
        wd = weekday(x["date"])
        closed = bool(x.get("closure")) or (x.get("eventMult") == 0) or wd in closed_wd or wd not in set(df["wd"].iloc[-56:])
        fut_rows.append({**x, "closed": closed})
    fo = [x for x in fut_rows if not x["closed"]]
    ranges = {}
    if fo:
        fdf = pd.DataFrame([{"date": x["date"], "wd": weekday(x["date"]), "wet": 1.0 if x.get("wet") else 0.0, "temp": x.get("tempMaxC"), "mult": float(x.get("eventMult") or 1.0), "t": t_last + (d(x["date"]) - last_date).days / 365.25, "doy": d(x["date"]).timetuple().tm_yday, "hasWeather": x.get("tempMaxC") is not None} for x in fo])
        mu = model.predict(fdf)
        for i, x in enumerate(fo):
            m = float(fdf["mult"].iloc[i])
            ranges[x["date"]] = {"mid": math.exp(mu[i]) * m, "low": math.exp(mu[i] + lo_q) * m, "high": math.exp(mu[i] + hi_q) * m}
    out_days = []
    for x in fut_rows:
        r = ranges.get(x["date"])
        ts = x.get("tsForecast")
        if r and ts and ts_wape is not None and best["wape"] is not None and ts_wape < best["wape"]:
            # The app's own forecast did better on the same days: centre on it, keep our honest width.
            r = {"mid": ts, "low": ts * r["low"] / r["mid"], "high": ts * r["high"] / r["mid"]}
        out_days.append({"date": x["date"], "closed": x["closed"] or r is None, "mid": round(r["mid"], 0) if r else 0, "low": round(r["low"], 0) if r else 0, "high": round(r["high"], 0) if r else 0, "ts": ts, "events": x.get("eventTitles") or []})

    # Weekly range from how whole weeks missed in the backtest (days partly cancel out, partly don't).
    bt = best["rows"]
    wk_ratios = []
    by_week: dict[tuple, list[dict]] = {}
    for r in bt:
        by_week.setdefault(d(r["date"]).isocalendar()[:2], []).append(r)
    for chunk in by_week.values():
        f, a = sum(r["forecast"] for r in chunk), sum(r["actual"] for r in chunk)
        if len(chunk) >= 4 and f > 0 and a > 0:
            wk_ratios.append(math.log(a / f))
    wk_sd = float(np.std(wk_ratios)) if len(wk_ratios) >= 4 else (hi_q - lo_q) / 2.56 / math.sqrt(3)
    wk_half = max(0.05, 1.28 * wk_sd)
    week = [x for x in out_days[:7] if not x["closed"]]
    total_mid = sum(x["mid"] for x in week)
    w_low, w_high = total_mid * math.exp(-wk_half), total_mid * math.exp(wk_half)
    busiest = max(week, key=lambda x: x["mid"]) if week else None
    new_better = ts_wape is None or (best["wape"] is not None and best["wape"] <= ts_wape)
    typical = best["wape"] or 0
    if busiest:
        headline = f"Next 7 days: about {money(total_mid)} (likely {money(w_low)}–{money(w_high)}). Busiest: {WEEKDAYS[weekday(busiest['date'])]}, about {money(busiest['mid'])}"
        action = f"Staff and prep for the middle number, and have someone on call for {WEEKDAYS[weekday(busiest['date'])]}."
    else:
        headline = "Closed all of the next 7 days."
        action = "Nothing to plan."
    if ts_wape is not None and not new_better:
        action += f" The app's own forecast did a little better lately ({pct(ts_wape)} typical miss vs {pct(typical)}), so the middle numbers come from it."
    conf = confidence(len(df), 0.0 if typical < 0.25 else 0.15, label_days=(d(df["date"].iloc[-1]) - d(df["date"].iloc[0])).days + 1)
    span = weeks_label((d(df["date"].iloc[-1]) - d(df["date"].iloc[0])).days + 1)
    how = [
        f"We looked at {len(df)} open days over {span}. A day's sales mostly depend on the weekday, the time of year and how the last few weeks have been running" + (", plus rain and temperature" if getattr(model, "weather", False) else "") + ". Planned events were taken out first and put back for future days.",
        f"Then we tested it honestly: for each of the last {len(bt)} open days we forecast it using only the days before it. It was typically within {pct(typical)} of the real day" + (f" (the app's own forecast: {pct(ts_wape)})" if ts_wape is not None else "") + ".",
        f"The likely range is how far real days landed from the forecast in that test: 4 days in 5 fell inside ranges this wide ({round(coverage * len(errs))} of {len(errs)}).",
        "Closed days — Tuesdays, closures, or a day with only a stray sale or two — are left out, so they don't drag the numbers down.",
    ]
    inputs = [inp("Open days of history", len(df)), inp("Days tested", len(bt))] + [inp(f"Typical miss — {k.lower()}", pct(v["wape"])) for k, v in candidates.items()]
    if ts_wape is not None:
        inputs.append(inp("Typical miss — the app's forecast", pct(ts_wape)))
    inputs.append(inp("Days inside the range in the test", pct(coverage)))
    return insight(
        "forecast",
        "Sales forecast",
        headline=headline,
        action=action,
        confidence=conf,
        how=how,
        inputs=inputs,
        chart={"type": "band", "rows": [{"date": x["date"], "mid": x["mid"], "low": x["low"], "high": x["high"], "closed": x["closed"]} for x in out_days], "history": [{"date": r["date"], "actual": round(r["actual"], 0), "forecast": round(r["forecast"], 0)} for r in bt[-28:]]},
        details={"days": out_days, "model": best_name, "mape": best["wape"], "tsMape": ts_wape, "coverage": coverage, "newBetter": new_better, "week": {"mid": total_mid, "low": w_low, "high": w_high}, "seconds": round(time.time() - t_start, 2), "models": {k: {"mape": v["wape"]} for k, v in candidates.items()}},
    )
