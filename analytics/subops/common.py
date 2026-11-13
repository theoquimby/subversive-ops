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
    w = n_days / 7
    if w < 2:
        return f"{n_days} days"
    return f"{round(w)} weeks"


def confidence(n_days: int, extra_penalty: float = 0.0, label_days: int | None = None) -> dict:
    """Confidence from how much history a model saw, minus a model-specific penalty (0..1)."""
    w = n_days / 7
    base = 0.25 if w < 4 else 0.45 if w < 8 else 0.6 if w < 16 else 0.75 if w < 52 else 0.85
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


def opportunity(key: str, kind: str, model: str, title: str, action: str, monthly: float, low: float | None = None, high: float | None = None, conf: float = 0.5, how: list[str] | None = None, inputs: list[dict] | None = None, href: str | None = None, subject: str | None = None) -> dict:
    lo = monthly if low is None else low
    hi = monthly if high is None else high
    return {
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
