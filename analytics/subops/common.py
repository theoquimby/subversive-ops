"""Shared shapes and helpers.

Every model returns an Insight dict:

    {
      "id": "menu", "title": "...", "status": "ok" | "thin" | "none",
      "headline": "one number in a sentence", "action": "what to do",
      "monthly": float | None,             # $/month at stake (positive = money to gain)
      "range": [low, high] | None,          # honest range on `monthly`
      "confidence": {"level": "low|medium|high", "score": 0..1, "note": "Based on 9 weeks — rough"},
      "how": ["paragraph", ...],            # "How we worked this out"
      "inputs": [{"label": str, "value": str}],  # every number traceable
      "chart": {...} | None,
      "details": {...},
      "opportunities": [Opportunity, ...],
    }

Opportunities feed the ranked list and the insight feed:

    {"key": "menu.reprice.<id>", "kind": "menu.reprice", "model": "menu", "title": str,
     "action": str, "monthly": float, "low": float, "high": float, "confidence": 0..1,
     "how": [str], "inputs": [...], "href": "/insights#menu"}
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Iterable

import numpy as np

DAYS_PER_MONTH = 30.4
WEEKS_PER_MONTH = DAYS_PER_MONTH / 7
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def d(iso: str) -> date:
    return date.fromisoformat(iso[:10])


def iso(x: date) -> str:
    return x.isoformat()


def add_days(iso_date: str, n: int) -> str:
    return iso(d(iso_date) + timedelta(days=n))


def weekday(iso_date: str) -> int:
    """Monday=0 … Sunday=6 (Python convention)."""
    return d(iso_date).weekday()


def money(x: float | None, cents: bool = False) -> str:
    if x is None or not math.isfinite(x):
        return "—"
    sign = "−" if x < 0 else ""
    v = abs(x)
    if cents:
        return f"{sign}${v:,.2f}"
    if v >= 100:
        v = round(v / 10) * 10 if v >= 1000 else round(v / 5) * 5
    return f"{sign}${v:,.0f}"


def exact_money(x: float | None) -> str:
    if x is None or not math.isfinite(x):
        return "—"
    return f"{'−' if x < 0 else ''}${abs(x):,.0f}"


def pct(x: float | None, digits: int = 0) -> str:
    if x is None or not math.isfinite(x):
        return "—"
    return f"{x * 100:.{digits}f}%"


def round_to(x: float, step: float) -> float:
    return round(x / step) * step


def weeks_label(n_days: int) -> str:
    """Plain-English span: "12 days", "9 weeks", "8 months", "3 years"."""
    w = n_days / 7
    if w < 2:
        return f"{n_days} day{'s' if n_days != 1 else ''}"
    if w < 17:
        return f"{round(w)} weeks"
    months = n_days / 30.4
    if months < 23.5:
        return f"{round(months)} months"
    years = n_days / 365.25
    return f"{round(years * 2) / 2:g} years"


def plural(n: float, one: str, many: str | None = None) -> str:
    """'1 person', '2 people', '1 extra shift', '3 extra shifts'."""
    k = round(n)
    return f"{k} {one if k == 1 else (many or one + 's')}"


def confidence(n_days: int, extra_penalty: float = 0.0, label_days: int | None = None) -> dict:
    """Confidence from how much history a model saw, minus a model-specific penalty (0..1)."""
    w = n_days / 7
    base = 0.25 if w < 4 else 0.45 if w < 8 else 0.6 if w < 16 else 0.75 if w < 52 else 0.82
    score = max(0.05, min(0.95, base - extra_penalty))
    level = "low" if score < 0.4 else "medium" if score < 0.65 else "high"
    word = {"low": "rough", "medium": "fair", "high": "solid"}[level]
    if w < 4:
        word = "very rough"
    return {"level": level, "score": round(score, 2), "note": f"Based on {weeks_label(label_days if label_days is not None else n_days)} — {word}"}


def insight(id: str, title: str, **kw: Any) -> dict:
    out = {
        "id": id,
        "title": title,
        "status": "ok",
        "headline": "",
        "action": "",
        "monthly": None,
        "range": None,
        "confidence": {"level": "low", "score": 0.2, "note": "Not enough data yet"},
        "how": [],
        "inputs": [],
        "chart": None,
        "details": {},
        "opportunities": [],
    }
    out.update(kw)
    return out


def thin(id: str, title: str, headline: str, action: str, how: list[str], note: str = "Needs more data") -> dict:
    return insight(id, title, status="thin", headline=headline, action=action, how=how, confidence={"level": "low", "score": 0.1, "note": note})


def story(now: str, why: str, todo: str, gain: str) -> dict:
    """The four beats every action is told in: what's happening → why we think so → what to do → what you'd gain."""
    return {"now": now, "why": why, "todo": todo, "gain": gain}


def opportunity(key: str, kind: str, model: str, title: str, action: str, monthly: float, low: float | None = None, high: float | None = None, conf: float = 0.5, how: list[str] | None = None, inputs: list[dict] | None = None, href: str | None = None, subject: str | None = None, *, area: str | None = None, effort: str | None = None, vector: str | None = None, story: dict | None = None, visual: dict | None = None, group: str | None = None, lead: bool | None = None) -> dict:
    """A finding. Optional extras (the app has defaults per kind when they're missing):
    area: staffing | menu | ordering | hours | costs; effort: easy | medium | hard;
    vector: save | earn | info; story: see story(); visual: a small chart spec;
    group: root cause — findings sharing a group are one action in the app; lead: the one to show."""
    lo = monthly if low is None else low
    hi = monthly if high is None else high
    extra = {k: v for k, v in {"area": area, "effort": effort, "vector": vector, "story": story, "visual": visual, "group": group, "lead": lead}.items() if v is not None}
    return {**extra,
        "key": key,
        "kind": kind,
        "model": model,
        "title": title,
        "action": action,
        "monthly": float(round(monthly, 2)),
        "low": float(round(min(lo, hi), 2)),
        "high": float(round(max(lo, hi), 2)),
        "confidence": float(round(conf, 2)),
        "how": how or [],
        "inputs": inputs or [],
        "href": href or f"/insights#{model}",
        "subject": subject,
    }


def inp(label: str, value: Any) -> dict:
    return {"label": label, "value": value if isinstance(value, str) else str(value)}


def robust_z(x: Iterable[float]) -> np.ndarray:
    """(x − median) / (1.4826 × MAD). A MAD of 0 falls back to the standard deviation."""
    a = np.asarray(list(x), dtype=float)
    if a.size == 0:
        return a
    med = np.nanmedian(a)
    mad = np.nanmedian(np.abs(a - med)) * 1.4826
    if not np.isfinite(mad) or mad < 1e-9:
        sd = np.nanstd(a)
        mad = sd if sd > 1e-9 else 1.0
    return (a - med) / mad


def shrink(estimate: float, se: float, prior: float, prior_sd: float) -> tuple[float, float]:
    """Precision-weighted average of a noisy estimate and a prior (normal–normal). Returns (mean, sd)."""
    if not (math.isfinite(estimate) and math.isfinite(se)) or se <= 0:
        return prior, prior_sd
    w_e = 1 / se**2
    w_p = 1 / prior_sd**2
    mean = (estimate * w_e + prior * w_p) / (w_e + w_p)
    return mean, math.sqrt(1 / (w_e + w_p))


def open_days(days: list[dict]) -> list[dict]:
    return [x for x in days if x.get("open") and (x.get("sales") or 0) > 0]


def safe_float(x: Any, default: float = 0.0) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def open_days_per_month(days: list[dict]) -> float:
    """Open days in a typical month, from the share of calendar days that were open."""
    od = open_days(days)
    if not od:
        return 26.0
    # Count from the first day with sales: days before the history starts aren't "closed".
    span = (d(max(x["date"] for x in days)) - d(min(x["date"] for x in od))).days + 1
    n_open = len(od)
    return DAYS_PER_MONTH * n_open / max(1, span) if n_open else 26.0


# ---- Data preparation (run once by the engine before any model) ------------------------

ASSUMED_COST_SHARE = 0.30  # food + drink cost when plate costs aren't set up yet (typical taproom with a kitchen)


def _median(v: list[float]) -> float:
    return float(np.median(v)) if v else 0.0


def prepare(data: dict) -> dict:
    """Clean the daily series in place so every model sees the same, sane history.

    - A day with a few stray sales (a refund, a test order, a private tasting on a
      closed day) isn't an open day: under 15% of a normal day around it → closed.
    - Weekdays that were closed most weeks lately (or aren't in the opening hours)
      are closed going forward, so the forecast doesn't invent a Tuesday.
    - Hourly rows on those days are dropped (their labor is prep, not service).
    Returns a summary the models and the app can show.
    """
    days = sorted(data.get("days") or [], key=lambda x: x["date"])
    data["days"] = days
    opened = [x for x in days if x.get("open") and (x.get("sales") or 0) > 0]
    stray: list[str] = []
    if len(opened) >= 14:
        idx = {x["date"]: i for i, x in enumerate(opened)}
        for x in opened:
            i = idx[x["date"]]
            around = [y["sales"] for y in opened[max(0, i - 30) : i + 31] if y is not x]
            ref = _median(around)
            if ref > 0 and x["sales"] < max(40.0, 0.15 * ref):
                x["open"] = False
                x["stray"] = True
                stray.append(x["date"])
    stray_set = set(stray)
    if stray_set and data.get("hourly"):
        data["hourly"] = [r for r in data["hourly"] if r["date"] not in stray_set]
    # Closed weekdays: from the opening hours when set (JS weekday keys, 0 = Sunday), else the last 8 weeks.
    closed: set[int] = set()
    oh = data.get("openingHours") or {}
    if oh:
        open_js = {int(k) for k, v in oh.items() if v}
        closed = {wd for wd in range(7) if (wd + 1) % 7 not in open_js}
    end = data.get("asOf") or (days[-1]["date"] if days else None)
    recent = [x for x in days if x["date"] >= add_days(end, -56)] if end else []
    by_wd: dict[int, list[bool]] = {}
    for x in recent:
        by_wd.setdefault(weekday(x["date"]), []).append(bool(x.get("open")))
    for wd, v in by_wd.items():
        if len(v) >= 4 and sum(v) / len(v) < 0.4:
            closed.add(wd)
    data["closedWeekdays"] = sorted(closed)
    trimmed = trim_renamed(data.get("items") or [])
    od = [x for x in days if x.get("open") and (x.get("sales") or 0) > 0]
    span = (d(od[-1]["date"]) - d(od[0]["date"])).days + 1 if od else 0
    summary = {"from": od[0]["date"] if od else None, "to": od[-1]["date"] if od else None, "openDays": len(od), "spanDays": span, "strayDays": len(stray), "closedWeekdays": sorted(closed), "renamedItems": trimmed}
    data["_prep"] = summary
    return summary


def _words(name: str) -> set[str]:
    import re

    return {w for w in re.findall(r"[a-z0-9]+", (name or "").lower()) if len(w) > 1 and w not in ("the", "and", "with", "oz", "of")}


def same_product(a: str, b: str) -> bool:
    """'House Smoked Pulled Pork' ~ 'House Smoked Pulled Pork Sandwich'; not ~ 'Chicken Club Sandwich Special'."""
    x, y = _words(a), _words(b)
    if not x or not y:
        return True
    return len(x & y) / min(len(x), len(y)) >= 0.6


def trim_renamed(items: list[dict]) -> int:
    """A Square button renamed to a different dish ('Kimchi Reuben' → 'Pulled Pork') carries the old dish's
    history. When the app sends the names an item sold under (`names`: [{name, from, to}]), history before
    the last switch to a different product is dropped. Returns how many items were trimmed."""
    n = 0
    for it in items:
        names = sorted(it.get("names") or [], key=lambda x: x.get("from") or "")
        if len(names) < 2:
            continue
        cur = max(names, key=lambda x: x.get("to") or "")["name"]
        start = None
        for x in reversed(names):
            if same_product(x["name"], cur):
                start = x["from"]
            else:
                break
        if start and start > (names[0].get("from") or start):
            for key in ("weekly", "daily"):
                h = it.get(key)
                if h:
                    # weekly keys are Mondays: keep the week the new product started in only if it's mostly new
                    it[key] = {k: v for k, v in h.items() if k >= (start if key == "daily" else add_days(start, -3))}
            it["historyFrom"] = start
            n += 1
    return n


def cost_share(data: dict, recent_days: int = 56) -> tuple[float, bool]:
    """Food + drink cost as a share of sales: measured when plate costs cover the sales, else assumed (30%)."""
    rows = open_days(data.get("days", []))[-recent_days:]
    s = sum(x["sales"] for x in rows)
    c = sum(float(x.get("cogs") or 0) for x in rows)
    if s > 0 and c / s >= 0.08:
        return c / s, True
    return ASSUMED_COST_SHARE, False


def cost_note(measured: bool, share: float) -> str:
    return f"food and drink cost of {pct(share)}" + ("" if measured else " (a typical figure — link Square items to recipes to use yours)")


def hour_label(h: int) -> str:
    s = "am" if h % 24 < 12 else "pm"
    hh = h % 12 or 12
    return f"{hh}{s}"


DAYPARTS = [(0, 11, "early morning"), (11, 13, "late morning"), (13, 16, "afternoon"), (16, 18, "early evening"), (18, 21, "evening"), (21, 24, "late night")]


def daypart(h: int) -> str:
    return next(name for a, b, name in DAYPARTS if a <= h < b)


def slot_key(wd: int, h: int) -> str:
    return f"slot.{wd}.{daypart(h).replace(' ', '-')}"


def hours_span(hours: list[int]) -> str:
    """[11, 12] → '11am–1pm'."""
    hs = sorted(hours)
    return f"{hour_label(hs[0])}–{hour_label(hs[-1] + 1)}"


def open_windows(data: dict, hourly: list[dict] | None = None) -> dict[int, tuple[int, int]]:
    """Service hours per weekday (Mon=0) as [open, close) clock hours.

    The opening hours set in the app win. Otherwise they're read from sales: an
    hour is open if it sells in at least half the weeks and brings in at least
    15% of a typical selling hour that day — so a setup hour with a stray $12
    sale, or cleanup after close, is never mistaken for service. Labor before
    open and after close is expected (setup, cleanup) and never judged."""
    oh = data.get("openingHours") or {}
    out: dict[int, tuple[int, int]] = {}
    for k, v in oh.items():
        try:
            a, b = int(v[0]), int(v[1])
        except (TypeError, ValueError, IndexError):
            continue
        if b > a:
            out[(int(k) + 6) % 7] = (a, b)
    if out:
        return out
    rows = hourly if hourly is not None else data.get("hourly") or []
    sales: dict[tuple[int, int], list[float]] = {}
    weeks: dict[int, set] = {}
    for r in rows:
        wd = weekday(r["date"])
        weeks.setdefault(wd, set()).add(r["date"])
        if (r.get("sales") or 0) > 0:
            sales.setdefault((wd, int(r["hour"])), []).append(float(r["sales"]))
    for wd, dates in weeks.items():
        n = len(dates)
        avg = {h: sum(v) / n for (w, h), v in sales.items() if w == wd and len(v) >= max(2, n * 0.5)}
        if not avg:
            continue
        typical = _median(list(avg.values()))
        hs = sorted(h for h, a in avg.items() if a >= 0.15 * typical)
        if hs:
            out[wd] = (hs[0], hs[-1] + 1)
    return out


def in_service(windows: dict[int, tuple[int, int]], wd: int, h: int) -> bool:
    w = windows.get(wd)
    return bool(w) and w[0] <= h < w[1]
