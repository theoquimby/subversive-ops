"""Staffing by hour: are there more people on the clock than the sales need?

For every weekday × hour we average sales and paid labor hours over the last
26 weeks (Square hourly sales + timecards split into clock hours; schedules
change, so older weeks would mislead). The store's own sales per labor hour is
the yardstick: an hour "needs" its sales ÷ that pace in people, never fewer
than the minimum crew. Hours with more people than that are over-staffed
(priced at the average loaded wage × 4.3 weeks); hours with far fewer are
running thin (service and upselling suffer — not a saving).

Neighbouring over-staffed hours on the same day are one finding ("Saturday
late morning"), so Max sees one move, not three. A cell with few weeks behind it
is shrunk toward "fine" so one odd week can't flag an hour.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from .common import WEEKDAY_SHORT, WEEKDAYS, WEEKS_PER_MONTH, add_days, confidence, in_service, open_windows, daypart, hour_label, hours_span, inp, insight, money, opportunity, plural, slot_key, story, weekday

RECENT_WEEKS = 26

__all__ = ["hour_label", "grid", "assess", "run", "recent_hourly"]


def recent_hourly(data: dict, weeks: int = RECENT_WEEKS) -> list[dict]:
    hourly = data.get("hourly", [])
    if not hourly:
        return []
    end = data.get("asOf") or max(r["date"] for r in hourly)
    since = add_days(end, -7 * weeks)
    return [r for r in hourly if r["date"] >= since]


def grid(hourly: list[dict], min_weeks: int = 3) -> tuple[list[dict], dict]:
    cells: dict[tuple[int, int], list[tuple[float, float, float]]] = defaultdict(list)
    for r in hourly:
        if (r.get("sales") or 0) <= 0 and (r.get("laborHours") or 0) <= 0:
            continue
        cells[(weekday(r["date"]), int(r["hour"]))].append((float(r.get("sales") or 0), float(r.get("laborHours") or 0), float(r.get("laborCost") or 0)))
    selling = [(s, h, c) for v in cells.values() for s, h, c in v if s > 0]
    tot_s = sum(s for s, _, _ in selling)
    tot_h = sum(h for _, h, _ in selling)
    all_h = sum(h for v in cells.values() for _, h, _ in v)
    all_c = sum(c for v in cells.values() for _, _, c in v)
    splh = tot_s / tot_h if tot_h else 0.0
    wage = all_c / all_h if all_h and all_c else 18.0
    out = []
    for (wd, h), v in cells.items():
        n = len(v)
        if n < min_weeks:
            continue
        s = float(np.mean([x[0] for x in v]))
        lh = float(np.mean([x[1] for x in v]))
        over_weeks = sum(1 for x in v if x[0] > 0 and x[1] > 0 and x[0] / x[1] < splh * 0.6)
        out.append({"wd": wd, "hour": h, "n": n, "sales": s, "laborHours": lh, "splh": s / lh if lh > 0 else None, "overWeeks": over_weeks})
    return out, {"splh": splh, "wage": wage, "hours": tot_h, "sales": tot_s}


def assess(cells: list[dict], meta: dict, min_crew: float = 2.0, windows: dict | None = None) -> list[dict]:
    """need = sales ÷ usual pace, never below the minimum crew. The first and last service hour get
    one extra person: the setup crew is finishing up, the closers are starting to clean."""
    splh = meta["splh"]
    for c in cells:
        w = (windows or {}).get(c["wd"])
        edge = 1.0 if w and c["hour"] in (w[0], w[1] - 1) else 0.0
        need = (max(min_crew, c["sales"] / splh) if splh else c["laborHours"]) + edge
        c["need"] = need
        # Shrink: with n weeks, trust the gap n/(n+2).
        c["gap"] = (c["laborHours"] - need) * c["n"] / (c["n"] + 2)
        c["monthly"] = c["gap"] * meta["wage"] * WEEKS_PER_MONTH
    return cells


def blocks(over: list[dict]) -> list[list[dict]]:
    """Group over-staffed hours into runs on the same weekday and part of the day."""
    by: dict[str, list[dict]] = defaultdict(list)
    for c in sorted(over, key=lambda c: (c["wd"], c["hour"])):
        by[slot_key(c["wd"], c["hour"])].append(c)
    return list(by.values())


def day_profile(cells: list[dict], wd: int, flagged: set[int]) -> dict:
    """Sales and wages per hour of one weekday, for the small chart."""
    rows = sorted([c for c in cells if c["wd"] == wd and c["sales"] > 0], key=lambda c: c["hour"])
    return {"type": "hours", "rows": [{"label": hour_label(c["hour"]), "sales": round(c["sales"]), "people": round(c["laborHours"], 1), "need": round(c["need"], 1), "flag": c["hour"] in flagged} for c in rows]}


def run(data: dict) -> dict:
    hourly_all = recent_hourly(data)
    windows = open_windows(data, hourly_all)
    # Only service hours are judged: setup before opening and cleanup after close are expected labor.
    hourly = [r for r in hourly_all if in_service(windows, weekday(r["date"]), int(r["hour"]))] if windows else hourly_all
    min_crew = float(data.get("minCrew") or 2)
    cells, meta = grid(hourly)
    weeks = min(RECENT_WEEKS, len({r["date"] for r in hourly}) / 6) if hourly else 0
    if len(cells) < 10 or meta["hours"] <= 0:
        return insight("staffing", "Staffing by hour", status="thin", headline="Needs 3 weeks of hourly sales and timecards.", action="Keep Square connected and have the team clock in on Square — this fills in on its own.", how=["Each hour of the week needs at least 3 weeks of sales and timecards behind it."], details={"needs": ["timecards"]})
    assess(cells, meta, min_crew, windows)
    selling = [c for c in cells if c["sales"] > 0]
    over_cells = [c for c in selling if c["gap"] > 0.5]
    under = sorted([c for c in selling if c["gap"] < -0.5 and c["laborHours"] > 0], key=lambda c: c["gap"])[:3]
    conf = confidence(int(weeks * 7), 0.05)
    opps = []
    groups = []
    for blk in blocks(over_cells):
        wd = blk[0]["wd"]
        monthly = sum(c["monthly"] for c in blk)
        # Only steady, material gaps: most of those weeks over, and worth at least $60 a month.
        if monthly < 60 or min(c["overWeeks"] / max(1, c["n"]) for c in blk) < 0.5:
            continue
        hrs = [c["hour"] for c in blk]
        span = hours_span(hrs)
        extra = max(c["gap"] for c in blk)
        people = max(1, round(extra))
        sales = sum(c["sales"] for c in blk) / len(blk)
        on = sum(c["laborHours"] for c in blk) / len(blk)
        need = sum(c["need"] for c in blk) / len(blk)
        n = min(c["n"] for c in blk)
        steady = min(c["overWeeks"] for c in blk)
        part = daypart(hrs[0])
        when = f"{WEEKDAYS[wd]} {part}"
        first, last = min(hrs), max(hrs) + 1
        w = windows.get(wd) if windows else None
        if w and first <= w[0]:
            todo = f"Stagger the start on {WEEKDAYS[wd]}s: bring {plural(people, 'person', 'people')} in at {hour_label(last)} instead of {hour_label(first)}"
        elif w and last >= w[1]:
            todo = f"Send {plural(people, 'person', 'people')} home at {hour_label(first)} on {WEEKDAYS[wd]}s and let the closers finish"
        else:
            todo = f"Give {plural(people, 'person', 'people')} a break or a prep task from {hour_label(first)} to {hour_label(last)} on {WEEKDAYS[wd]}s, or split the shift"
        grp = slot_key(wd, hrs[0])
        groups.append({"group": grp, "wd": wd, "hours": hrs, "monthly": monthly, "people": people})
        opps.append(opportunity(
            f"staffing.over.{wd}.{hrs[0]}", "staffing.over", "staffing",
            f"{when} has more people on than it needs",
            f"{todo}.",
            monthly, monthly * 0.6, monthly, conf["score"] * (0.9 if steady >= n * 0.5 else 0.75),
            [f"From {span} on {WEEKDAYS[wd]}s you average {money(sales)} of sales an hour with {on:.1f} people on the clock. At your usual pace of {money(meta['splh'])} of sales per person per hour, that needs about {need:.1f} (never fewer than {min_crew:.0f}).", f"Based on the last {n} {WEEKDAYS[wd]}s; the gap is shrunk a little because a few weeks can mislead."],
            [inp("Sales per hour (avg)", money(sales)), inp("People on the clock", f"{on:.1f}"), inp("People the sales need", f"{need:.1f}"), inp("Usual sales per person per hour", money(meta["splh"])), inp("Average wage with taxes", money(meta["wage"], True)), inp("Weeks", n)],
            href="/schedule", subject=f"{wd}.{hrs[0]}",
            area="staffing", effort="easy", vector="save", group=grp,
            story=story(
                f"On {WEEKDAYS[wd]}s from {span} you average {money(sales)} of sales an hour with {on:.1f} people on the clock.",
                f"Across the whole week each person on the clock brings in about {money(meta['splh'])} an hour. At that pace these hours need about {need:.1f} people — so roughly {plural(extra, 'person is', 'people are')} waiting for guests. It's been like this most of the last {n} {WEEKDAYS[wd]}s.",
                f"{todo}. Keep at least {min_crew:.0f} on while you're open.",
                f"About {money(monthly)} a month in wages, with no change to what guests see.",
            ),
            visual=day_profile(cells, wd, set(hrs)),
        ))
    opps.sort(key=lambda o: -o["monthly"])
    opps = opps[:4]
    total = sum(o["monthly"] for o in opps)
    name = lambda c: f"{WEEKDAYS[c['wd']]} {hour_label(c['hour'])}–{hour_label(c['hour'] + 1)}"
    if opps:
        headline = f"{opps[0]['title']} — about {money(opps[0]['monthly'])} a month"
        action = opps[0]["action"] + (f" {name(under[0])} runs thin: each person handles {money(under[0]['splh'] or 0)} an hour, about {round((under[0]['splh'] or 0) / meta['splh'], 1)}× usual." if under else "")
    elif under:
        headline = f"{name(under[0])} is short-handed: each person handles {money(under[0]['splh'] or 0)} an hour vs {money(meta['splh'])} usual"
        action = f"Add a person around {name(under[0])}."
    else:
        headline = "Your staffing follows your sales well, hour by hour"
        action = "Nothing to change."
    hours = sorted({c["hour"] for c in selling})
    wds = sorted({c["wd"] for c in selling})
    how = [
        f"We split every timecard into clock hours and lined them up with Square's sales for that hour, then averaged each weekday and hour over the last {weeks:.0f} weeks (schedules change, so older weeks would mislead).",
        f"Across the week, each person on the clock brings in about {money(meta['splh'])} of sales an hour. An hour 'needs' its sales ÷ that pace, but never fewer than {min_crew:.0f} people while you're open.",
        f"Extra people cost their hours × {money(meta['wage'], True)} (average wage with employer taxes) × 4.3 weeks a month. Short-handed hours aren't a saving — they're where service and upselling suffer.",
        "Setup before you open and cleanup after you close are expected, so those hours are never judged — only the hours you're serving guests" + (" (" + ", ".join(f"{WEEKDAY_SHORT[w]} {hour_label(a)}–{hour_label(b)}" for w, (a, b) in sorted(windows.items())) + ")" if windows else "") + ".",
    ]
    return insight(
        "staffing",
        "Staffing by hour",
        headline=headline,
        action=action,
        monthly=total or None,
        range=[total * 0.6, total] if total else None,
        confidence=conf,
        how=how,
        inputs=[inp(name(c), f"{money(c['sales'])} sales, {c['laborHours']:.1f} on the clock, need {c['need']:.1f}") for c in sorted(over_cells, key=lambda c: -c["gap"])[:6] + under],
        chart={"type": "heatmap", "rows": [WEEKDAY_SHORT[w] for w in wds], "cols": [hour_label(h) for h in hours], "cells": [{"r": wds.index(c["wd"]), "c": hours.index(c["hour"]), "splh": round(c["splh"] or 0, 0), "sales": round(c["sales"], 0), "people": round(c["laborHours"], 1), "flag": "over" if c in over_cells and c["monthly"] > 10 else "under" if c in under else None} for c in selling], "splh": round(meta["splh"], 0)},
        details={"windows": {str(k): list(v) for k, v in windows.items()}, "over": sorted(over_cells, key=lambda c: -c["gap"])[:6], "under": under, "splh": meta["splh"], "wage": meta["wage"], "groups": groups, "weeks": weeks, "cells": [{k: c[k] for k in ("wd", "hour", "sales", "laborHours", "need", "n")} for c in selling]},
        opportunities=opps,
    )
