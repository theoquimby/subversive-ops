"""Context for every finding: what a fair comparison looks like, and how to explain it.

A raw before/after (or "this hour vs the week") mixes the thing we're judging
with everything else that moved at the same time — how busy the place was, the
weekday mix, the season, a holiday, a storm, an event, a keg that kicked. This
module gives every model the same tools to take those out, and the same
"evidence" block to show the owner exactly what was compared:

- `DayContext`: one pass over the daily history. Every date knows whether it's
  a fair day to compare (open, not an event, not a holiday, not a short day),
  what a normal day of that weekday looks like at that time of year, and what
  the forecast would have said a week ahead (what the schedule was built on).
- `holidays()`: the US holidays and long weekends that move a taproom.
- `standardized_rate()` / `bootstrap_rate()`: a rate per 100 orders with the
  weekday mix held fixed, plus its uncertainty by resampling days.
- `evidence()`: the structured block the app renders in "Show me how".

Everything here is plain arithmetic on the payload — no new data needed.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import numpy as np

from .common import WEEKDAYS, add_days, d, iso, weekday

# ---- Holidays ----------------------------------------------------------------------------


def _nth_weekday(year: int, month: int, wd: int, n: int) -> date:
    """n-th weekday (Mon=0) of a month; n = -1 → the last one."""
    if n > 0:
        first = date(year, month, 1)
        return first + timedelta(days=(wd - first.weekday()) % 7 + 7 * (n - 1))
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    last = nxt - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - wd) % 7)


def _easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    dd, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - dd - g + 15) % 30
    i, k = c // 4, c % 4
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ll) // 451
    month = (h + ll - 7 * m + 114) // 31
    day = ((h + ll - 7 * m + 114) % 31) + 1
    return date(y, month, day)


_HOLIDAY_CACHE: dict[int, dict[str, str]] = {}


def holidays(year: int) -> dict[str, str]:
    """ISO date → name, for the days that run unlike a normal weekday."""
    if year in _HOLIDAY_CACHE:
        return _HOLIDAY_CACHE[year]
    memorial = _nth_weekday(year, 5, 0, -1)
    labor = _nth_weekday(year, 9, 0, 1)
    thanks = _nth_weekday(year, 11, 3, 4)
    out = {
        date(year, 1, 1): "New Year's Day",
        _easter(year): "Easter",
        _nth_weekday(year, 5, 6, 2): "Mother's Day",
        memorial - timedelta(days=1): "Memorial Day weekend",
        memorial: "Memorial Day",
        _nth_weekday(year, 6, 6, 3): "Father's Day",
        date(year, 7, 4): "July 4th",
        labor - timedelta(days=1): "Labor Day weekend",
        labor: "Labor Day",
        date(year, 10, 31): "Halloween",
        thanks - timedelta(days=1): "the night before Thanksgiving",
        thanks: "Thanksgiving",
        thanks + timedelta(days=1): "the day after Thanksgiving",
        date(year, 12, 24): "Christmas Eve",
        date(year, 12, 25): "Christmas",
        date(year, 12, 31): "New Year's Eve",
    }
    _HOLIDAY_CACHE[year] = {iso(k): v for k, v in out.items()}
    return _HOLIDAY_CACHE[year]


def holiday(iso_date: str) -> str | None:
    return holidays(int(iso_date[:4])).get(iso_date[:10])


def nice_date(iso_date: str, as_of: str | None = None) -> str:
    x = d(iso_date)
    ref = d(as_of).year if as_of else date.today().year
    return f"{x.strftime('%b')} {x.day}" + (f", {x.year}" if x.year != ref else "")


def week_monday(iso_date: str) -> str:
    x = d(iso_date)
    return iso(x - timedelta(days=x.weekday()))


# ---- Days: which are fair to compare, and what's normal ------------------------------------

SHORT_DAY = 0.4  # under 40% of a normal day for that weekday and time of year: closed early, a storm, a power cut


class DayContext:
    """One pass over the daily history; every model asks it the same questions."""

    def __init__(self, data: dict):
        self.as_of = data.get("asOf") or (data["days"][-1]["date"] if data.get("days") else iso(date.today()))
        self.days: dict[str, dict] = {x["date"]: x for x in data.get("days") or []}
        self.dates = sorted(self.days)
        self.open = {k for k, x in self.days.items() if x.get("open") and (x.get("sales") or 0) > 0}
        self.by_wd: dict[int, list[str]] = defaultdict(list)
        for k in self.dates:
            if k in self.open:
                self.by_wd[weekday(k)].append(k)
        self._normal: dict[tuple[str, str], float | None] = {}
        self._reason: dict[str, str | None] = {}
        self.first = self.dates[0] if self.dates else self.as_of

    # -- what kind of day was it?

    def special(self, k: str) -> str | None:
        """Why a day isn't a fair day to compare: 'closed', 'event', 'holiday', 'short' — or None."""
        if k in self._reason:
            return self._reason[k]
        x = self.days.get(k)
        r: str | None = None
        if not x or k not in self.open:
            r = "closed"
        elif x.get("eventKinds") or (x.get("eventMult") not in (None, 1, 1.0)):
            r = "event"
        elif holiday(k):
            r = "holiday"
        else:
            n = self.normal(k, "sales", exclude_self=True)
            if n and x["sales"] < SHORT_DAY * n:
                r = "short"
        self._reason[k] = r
        return r

    def fair(self, k: str) -> bool:
        return self.special(k) is None

    def label(self, k: str) -> str:
        """'Labor Day (Sep 7)', 'a short day (Oct 3)'."""
        r = self.special(k)
        when = nice_date(k, self.as_of)
        if r == "holiday":
            return f"{holiday(k)} ({when})"
        if r == "event":
            t = ", ".join((self.days[k].get("eventTitles") or [])[:2]) or "an event"
            return f"{t} ({when})"
        if r == "short":
            return f"a short day ({when})"
        return f"closed ({when})"

    def normal(self, k: str, metric: str = "sales", span: int = 28, exclude_self: bool = True) -> float | None:
        """Median of the same weekday within ±span days (a normal day of that kind, at that time of year).
        Event days and holidays don't count toward 'normal'."""
        key = (k, metric + str(span) + str(exclude_self))
        if key in self._normal:
            return self._normal[key]
        lo, hi = add_days(k, -span), add_days(k, span)
        v = []
        for j in self.by_wd.get(weekday(k), []):
            if j < lo or j > hi or (exclude_self and j == k):
                continue
            x = self.days[j]
            if x.get("eventKinds") or holiday(j):
                continue
            val = x.get(metric)
            if val is not None and (metric != "laborHours" or val > 0):
                v.append(float(val))
        out = float(np.median(v)) if len(v) >= 2 else None
        self._normal[key] = out
        return out

    def recent_level(self, k: str, metric: str = "sales", lag: int = 7, weeks: int = 8) -> tuple[float | None, int]:
        """Median of the same weekday over `weeks` weeks ending `lag` days before k (what you knew then)."""
        hi, lo = add_days(k, -lag), add_days(k, -lag - 7 * weeks)
        v = [float(self.days[j].get(metric) or 0) for j in self.by_wd.get(weekday(k), []) if lo <= j <= hi and self.fair(j)]
        return (float(np.median(v)) if len(v) >= 3 else None), len(v)

    def season_ratio(self, k: str, lag: int = 7, weeks: int = 8) -> float | None:
        """How last year moved from the weeks before to this week: e.g. 0.85 = this time last year ran 15% below
        the two months before it. None without last year's data."""
        ly = add_days(k, -364)
        if ly < self.first:
            return None
        lo_ly, _ = self.recent_level(ly, "sales", lag, weeks)
        v = [float(self.days[j]["sales"]) for j in self.by_wd.get(weekday(k), []) if add_days(ly, -7) <= j <= add_days(ly, 7) and self.fair(j)]
        if not lo_ly or len(v) < 2:
            return None
        return float(np.clip(np.median(v) / lo_ly, 0.5, 1.8))

    def expected_ahead(self, k: str, lag: int = 7) -> dict | None:
        """What a forecast made `lag` days ahead (when the schedule was written) would have said:
        the same weekday over the 8 weeks before, moved the way last year moved into this week."""
        base, n = self.recent_level(k, "sales", lag)
        if not base:
            return None
        sr = self.season_ratio(k, lag)
        mult = float((self.days.get(k) or {}).get("eventMult") or 1.0) if (self.days.get(k) or {}).get("eventKinds") else 1.0
        return {"base": base, "season": sr, "expected": base * (sr or 1.0) * mult, "n": n}

    def excluded_summary(self, dates: list[str]) -> list[str]:
        """Plain-English list of what was left out among `dates` (and why)."""
        by: dict[str, list[str]] = defaultdict(list)
        for k in dates:
            r = self.special(k)
            if r and r != "closed":
                by[r].append(k)
        out = []
        for k in by.get("holiday", []):
            out.append(self.label(k))
        if by.get("event"):
            out.append(f"{len(by['event'])} event day{'s' if len(by['event']) != 1 else ''}" + (f" ({', '.join(nice_date(k, self.as_of) for k in by['event'][:3])})" if len(by["event"]) <= 3 else ""))
        if by.get("short"):
            out.append(f"{len(by['short'])} short day{'s' if len(by['short']) != 1 else ''} (under 40% of a normal day — closed early, weather or the like)" + (f": {', '.join(nice_date(k, self.as_of) for k in by['short'][:3])}" if len(by["short"]) <= 3 else ""))
        return out


_CTX_KEY = "_dayctx"


def day_context(data: dict) -> DayContext:
    """Cached per payload (rebuilt if the days list changed)."""
    days = data.get("days") or []
    sig = (id(days), len(days), days[-1]["date"] if days else None, data.get("asOf"))
    c = data.get(_CTX_KEY)
    if c is not None and getattr(c, "_sig", None) == sig:
        return c
    c = DayContext(data)
    c._sig = sig  # type: ignore[attr-defined]
    data[_CTX_KEY] = c
    return c


# ---- Rates with the weekday mix held fixed ----------------------------------------------------


def standardized_rate(rows_a: list[tuple[int, float, float]], rows_b: list[tuple[int, float, float]]) -> tuple[float, float, list[int]]:
    """rows: (weekday, units, orders). Units per order in each period, each weekday weighted by its share
    of orders across both periods — so an 'after' with more Mondays isn't judged against a Saturday-heavy 'before'."""
    wds = sorted({w for w, _, _ in rows_a} & {w for w, _, _ in rows_b})
    if not wds:
        return float("nan"), float("nan"), []
    tot = {w: sum(o for x, _, o in rows_a + rows_b if x == w) for w in wds}
    T = sum(tot.values()) or 1.0

    def rate(rows):
        r = 0.0
        for w in wds:
            u = sum(q for x, q, _ in rows if x == w)
            o = sum(o for x, _, o in rows if x == w)
            r += (tot[w] / T) * (u / o if o > 0 else 0.0)
        return r

    return rate(rows_a), rate(rows_b), wds


def bootstrap_rates(rows_a: list[tuple[int, float, float]], rows_b: list[tuple[int, float, float]], n: int = 800, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Resample days within each weekday of each period; returns (rate_a, rate_b) samples, weekday-standardized."""
    rng = np.random.default_rng(seed)
    wds = sorted({w for w, _, _ in rows_a} & {w for w, _, _ in rows_b})
    tot = {w: sum(o for x, _, o in rows_a + rows_b if x == w) for w in wds}
    T = sum(tot.values()) or 1.0

    def samples(rows):
        out = np.zeros(n)
        for w in wds:
            u = np.array([q for x, q, _ in rows if x == w], dtype=float)
            o = np.array([o for x, _, o in rows if x == w], dtype=float)
            idx = rng.integers(0, len(u), size=(n, len(u)))
            su, so = u[idx].sum(1), o[idx].sum(1)
            out += (tot[w] / T) * np.where(so > 0, su / np.maximum(so, 1e-9), 0.0)
        return out

    return samples(rows_a), samples(rows_b)


def bootstrap_weeks(rows_a: list[tuple[str, int, float, float]], rows_b: list[tuple[str, int, float, float]], n: int = 800, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Like bootstrap_rates, but resamples whole weeks (rows: (week, weekday, units, orders)).
    Days in the same week aren't independent — a keg out for a week, a street fair, a cold snap —
    so resampling weeks gives an honest range. Weekday weights stay fixed; a weekday missing from a
    resample is left out and the rest re-weighted."""
    rng = np.random.default_rng(seed)
    wds = sorted({w for _, w, _, _ in rows_a} & {w for _, w, _, _ in rows_b})
    if not wds:
        return np.full(n, np.nan), np.full(n, np.nan)
    tot = np.array([sum(o for _, x, _, o in rows_a + rows_b if x == w) for w in wds], dtype=float)
    wts = tot / (tot.sum() or 1.0)
    col = {w: i for i, w in enumerate(wds)}

    def samples(rows):
        weeks = sorted({k for k, _, _, _ in rows})
        U = np.zeros((len(weeks), len(wds)))
        O = np.zeros((len(weeks), len(wds)))
        wi = {k: i for i, k in enumerate(weeks)}
        for k, w, q, o in rows:
            if w in col:
                U[wi[k], col[w]] += q
                O[wi[k], col[w]] += o
        idx = rng.integers(0, len(weeks), size=(n, len(weeks)))
        su, so = U[idx].sum(1), O[idx].sum(1)  # (n, wds)
        have = so > 0
        r = np.where(have, su / np.maximum(so, 1e-9), 0.0)
        ww = np.where(have, wts, 0.0)
        out = (r * ww).sum(1) / np.maximum(ww.sum(1), 1e-9)
        # With a handful of weeks, resampling understates the spread by about √((k−1)/k); put it back.
        k = len(weeks)
        if k > 1:
            mid = float(np.nanmean(out))
            out = mid + (out - mid) * math.sqrt(k / (k - 1))
        return out

    return samples(rows_a), samples(rows_b)


def bootstrap_pooled(units: list[float], orders: list[float], n: int = 800, seed: int = 11) -> np.ndarray:
    """Pooled units ÷ orders over resampled weeks (or days)."""
    rng = np.random.default_rng(seed)
    u, o = np.asarray(units, float), np.asarray(orders, float)
    if len(u) == 0:
        return np.full(n, np.nan)
    idx = rng.integers(0, len(u), size=(n, len(u)))
    return u[idx].sum(1) / np.maximum(o[idx].sum(1), 1e-9)


# ---- Words ----------------------------------------------------------------------------------------


def pct_words(x: float, digits: int = 0) -> str:
    """+0.08 → '+8%', −0.1 → '−10%'."""
    if x is None or not math.isfinite(x):
        return "—"
    v = round(abs(x) * 100, digits)
    if v == 0:
        return "0%"
    return f"{'+' if x > 0 else '−'}{v:.{digits}f}%"


def range_words(lo: float, hi: float) -> str:
    return f"{pct_words(lo)} to {pct_words(hi)}"


def num_words(x: float, digits: int = 1) -> str:
    if x is None or not math.isfinite(x):
        return "—"
    return f"{x:,.{digits}f}"


def money_words(x: float | None) -> str:
    if x is None or not math.isfinite(x):
        return "—"
    return f"{'−' if x < 0 else ''}${abs(x):,.0f}" if abs(x) >= 100 else f"{'−' if x < 0 else ''}${abs(x):,.2f}"


def row(label: str, before: Any = None, after: Any = None, change: float | None = None, *, value: str | None = None, note: str | None = None, strong: bool = False) -> dict:
    """One line of the evidence table: either before → after (and the change), or a single value."""
    out: dict[str, Any] = {"label": label}
    if value is not None:
        out["value"] = value
    if before is not None:
        out["before"] = before if isinstance(before, str) else str(before)
    if after is not None:
        out["after"] = after if isinstance(after, str) else str(after)
    if change is not None and math.isfinite(change):
        out["change"] = pct_words(change)
        out["changePct"] = round(float(change), 4)
    if note:
        out["note"] = note
    if strong:
        out["strong"] = True
    return out


def sure_line(level: str, why: str) -> str:
    word = {"high": "Pretty sure", "medium": "Fairly sure", "low": "Not sure yet"}.get(level, "Fairly sure")
    return f"{word}: {why}"


def evidence(*, verdict: str, summary: str, rows: list[dict] | None = None, steps: list[str] | None = None, excluded: list[str] | None = None, method: str, sure: str, effect: dict | None = None, chart: dict | None = None, watch: str | None = None) -> dict:
    """The "Show me how" block. verdict: 'real' (it counts), 'unclear' (not distinguishable from normal
    ups and downs — watching), 'good' (a change that worked), 'info'."""
    out: dict[str, Any] = {"verdict": verdict, "summary": summary, "rows": rows or [], "steps": steps or [], "excluded": excluded or [], "method": method, "sure": sure}
    if effect:
        out["effect"] = {k: (round(float(v), 4) if isinstance(v, (int, float)) else v) for k, v in effect.items()}
    if chart:
        out["chart"] = chart
    if watch:
        out["watch"] = watch
    return out


def basic_evidence(o: dict) -> dict:
    """For findings that don't build their own: the inputs as rows, the reasoning as steps, and a
    'how sure' line from the confidence."""
    c = float(o.get("confidence") or 0)
    level = "high" if c >= 0.6 else "medium" if c >= 0.4 else "low"
    why = {"high": "the pattern is steady across the weeks we looked at.", "medium": "the pattern shows up most weeks, but the dollars could be off by a fair bit.", "low": "it's based on a short stretch or a few examples — treat it as a hunch to check."}[level]
    how = [h for h in (o.get("how") or []) if isinstance(h, str)]
    return evidence(
        verdict="real",
        summary=(o.get("story") or {}).get("why") or (how[0] if how else o.get("title", "")),
        rows=[row(i["label"], value=i["value"]) for i in (o.get("inputs") or []) if isinstance(i, dict) and "label" in i],
        steps=how[1:] if (o.get("story") or {}).get("why") is None else how,
        method=how[0] if how else "",
        sure=sure_line(level, why),
    )


def weekday_word(wd: int) -> str:
    return WEEKDAYS[wd]
