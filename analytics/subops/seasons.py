"""Your seasons: how each month runs against a typical month, and how this year compares.

With a few years of history the shape of the year is the most dependable thing
in the data. For each calendar month we average daily sales over open days, per
year, divide by that year's average day (so growth doesn't bend the shape) and
average across years. The year-on-year line compares the last 12 complete
months with the 12 before, and the last 3 complete months with the same months
a year earlier.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from .common import confidence, d, inp, insight, money, open_days, pct, weeks_label

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _month_key(iso_date: str) -> tuple[int, int]:
    x = d(iso_date)
    return x.year, x.month


def run(data: dict) -> dict:
    od = open_days(data.get("days", []))
    if not od:
        return insight("seasons", "Your seasons", status="thin", headline="Needs a year of sales to see your seasons.", action="Keep Square connected.", how=[])
    span = (d(od[-1]["date"]) - d(od[0]["date"])).days + 1
    if span < 330:
        return insight("seasons", "Your seasons", status="thin", headline=f"Needs a full year of sales to see your seasons ({weeks_label(span)} so far).", action="Pick a longer range at the top, or keep Square connected.", how=["The shape of the year only shows once every month has been seen at least once."], details={"needs": ["year"]})
    # Average day per (year, month); open days per month too.
    cells: dict[tuple[int, int], list[float]] = defaultdict(list)
    for x in od:
        cells[_month_key(x["date"])].append(float(x["sales"]))
    last_full = _month_key(od[-1]["date"])
    as_of = d(data.get("asOf") or od[-1]["date"])
    complete = {k: v for k, v in cells.items() if not (k == (as_of.year, as_of.month)) and len(v) >= 8}
    years = sorted({y for y, _ in complete})
    idx_by_year: dict[int, dict[int, float]] = {}
    for y in years:
        months = {m: float(np.mean(v)) for (yy, m), v in complete.items() if yy == y}
        if len(months) < 6:
            continue
        base = float(np.mean(list(months.values())))
        idx_by_year[y] = {m: v / base for m, v in months.items()}
    index = []
    for m in range(1, 13):
        vals = [v[m] for v in idx_by_year.values() if m in v]
        index.append(float(np.mean(vals)) if vals else None)
    known = [(m, v) for m, v in enumerate(index) if v is not None]
    if len(known) < 10:
        return insight("seasons", "Your seasons", status="thin", headline="Needs a full year of sales to see your seasons.", action="Pick a longer range at the top.", how=[], details={"needs": ["year"]})
    slow = min(known, key=lambda t: t[1])
    busy = max(known, key=lambda t: t[1])
    avg_day = float(np.mean([x["sales"] for x in od[-365:]]))
    # Year on year: last 12 complete months vs the 12 before.
    keys = sorted(complete)
    last12 = [k for k in keys if (last_full[0] * 12 + last_full[1]) - (k[0] * 12 + k[1]) in range(1, 13)]
    prev12 = [(y - 1, m) for y, m in last12]
    yoy = None
    if all(k in complete for k in prev12) and last12:
        a = sum(np.mean(complete[k]) * len(complete[k]) for k in last12)
        b = sum(np.mean(complete[k]) * len(complete[k]) for k in prev12)
        yoy = a / b - 1 if b else None
    last3 = last12[-3:]
    q = None
    if last3 and all((y - 1, m) in complete for y, m in last3):
        a = sum(np.mean(complete[k]) * len(complete[k]) for k in last3)
        b = sum(np.mean(complete[(y - 1, m)]) * len(complete[(y - 1, m)]) for y, m in last3)
        q = a / b - 1 if b else None
    winter = [m for m, v in known if v < 0.85]
    # In calendar order starting after the busiest month, so a Dec–Mar stretch reads Dec, Jan, Feb, Mar.
    winter.sort(key=lambda m: (m - busy[0]) % 12)
    headline = f"{LONG[slow[0]]} is your slowest month (about {pct(slow[1])} of a typical month); {LONG[busy[0]]} your busiest ({pct(busy[1])})"
    if winter:
        action = f"Plan the quiet stretch ({', '.join(MONTHS[m] for m in winter)}): lighter schedules, smaller orders, and save promotions and events for those months."
    else:
        action = "Your year is fairly even — plan around weekdays more than months."
    trend = ""
    if yoy is not None:
        trend = f"The last 12 months were {'up' if yoy >= 0 else 'down'} {pct(abs(yoy))} on the 12 before"
        if q is not None:
            trend += f"; the last 3 months {'up' if q >= 0 else 'down'} {pct(abs(q))} on the same months last year"
        trend += "."
    how = [
        f"For each month we took the average open day, in each year we have ({', '.join(str(y) for y in idx_by_year)}), as a share of that year's average day — so growth doesn't bend the shape — and averaged the years.",
        f"A typical open day over the last year was about {money(avg_day)}. " + trend,
    ]
    series = []
    for y in sorted(idx_by_year)[-4:]:
        series.append({"year": y, "values": [round(float(np.mean(cells[(y, m)])), 0) if (y, m) in cells and len(cells[(y, m)]) >= 4 else None for m in range(1, 13)]})
    conf = confidence(len(od), 0.0 if len(idx_by_year) >= 2 else 0.15, label_days=span)
    return insight(
        "seasons",
        "Your seasons",
        headline=headline,
        action=action,
        confidence=conf,
        how=how,
        inputs=[inp(LONG[m], pct(v)) for m, v in known] + ([inp("Last 12 months vs the 12 before", f"{yoy * 100:+.0f}%")] if yoy is not None else []),
        chart={"type": "seasons", "months": MONTHS, "index": [round(v, 3) if v is not None else None for v in index], "years": series},
        details={"index": index, "slow": slow[0], "busy": busy[0], "yoy": yoy, "last3": q, "avgDay": avg_day, "years": list(idx_by_year), "trend": trend},
    )
