"""Staffing efficiency: sales per labor hour, hour by hour of the week.

For every weekday × hour we average sales and paid labor hours over the weeks
we have (Square hourly sales + timecards split into clock hours). The store's
own sales per labor hour (SPLH) is the yardstick: an hour "needs" sales ÷ SPLH
people-hours, never fewer than the minimum crew. Hours with the most hours
above need are over-staffed (priced at the average loaded wage × 4.3 weeks);
hours with the most below need are under-staffed (people are handling far
more than usual — service and upsell suffer).

Cell averages with few weeks behind them are shrunk toward the weekday's
own level so one odd week doesn't flag an hour.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from .common import WEEKDAY_SHORT, WEEKDAYS, WEEKS_PER_MONTH, confidence, inp, insight, money, opportunity, weekday


def hour_label(h: int) -> str:
    s = "am" if h < 12 else "pm"
    hh = h % 12 or 12
    return f"{hh}{s}"


def grid(hourly: list[dict], min_weeks: int = 3) -> tuple[list[dict], dict]:
    cells: dict[tuple[int, int], list[tuple[float, float, float]]] = defaultdict(list)
    for r in hourly:
        if (r.get("sales") or 0) <= 0 and (r.get("laborHours") or 0) <= 0:
            continue
        cells[(weekday(r["date"]), int(r["hour"]))].append((float(r.get("sales") or 0), float(r.get("laborHours") or 0), float(r.get("laborCost") or 0)))
    tot_s = sum(s for v in cells.values() for s, _, _ in v)
    tot_h = sum(h for v in cells.values() for _, h, _ in v)
    tot_c = sum(c for v in cells.values() for _, _, c in v)
    splh = tot_s / tot_h if tot_h else 0.0
    wage = tot_c / tot_h if tot_h else 18.0
    out = []
    for (wd, h), v in cells.items():
        n = len(v)
        if n < min_weeks:
            continue
        s = float(np.mean([x[0] for x in v]))
        lh = float(np.mean([x[1] for x in v]))
        out.append({"wd": wd, "hour": h, "n": n, "sales": s, "laborHours": lh, "splh": s / lh if lh > 0 else None})
    return out, {"splh": splh, "wage": wage, "hours": tot_h, "sales": tot_s}


def assess(cells: list[dict], meta: dict, min_crew: float = 2.0) -> list[dict]:
    splh = meta["splh"]
    for c in cells:
        need = max(min_crew, c["sales"] / splh) if splh else c["laborHours"]
        c["need"] = need
        # Shrink: with n weeks, trust the gap n/(n+2).
        c["gap"] = (c["laborHours"] - need) * c["n"] / (c["n"] + 2)
        c["monthly"] = c["gap"] * meta["wage"] * WEEKS_PER_MONTH
    return cells


def run(data: dict) -> dict:
    hourly = data.get("hourly", [])
    min_crew = float(data.get("minCrew") or 2)
    cells, meta = grid(hourly)
    weeks = len({r["date"] for r in hourly}) / 6 if hourly else 0
    if len(cells) < 10 or meta["hours"] <= 0:
        return insight("staffing", "Staffing by hour", status="thin", headline="Needs 3+ weeks of hourly sales and timecards.", action="Nothing to do yet.", how=["Each hour of the week needs at least 3 weeks behind it."])
    assess(cells, meta, min_crew)
    selling = [c for c in cells if c["sales"] > 0]
    over = sorted([c for c in selling if c["gap"] > 0.5], key=lambda c: -c["gap"])[:3]
    under = sorted([c for c in selling if c["gap"] < -0.5], key=lambda c: c["gap"])[:3]
    conf = confidence(int(weeks * 7), 0.05)
    name = lambda c: f"{WEEKDAYS[c['wd']]} {hour_label(c['hour'])}–{hour_label((c['hour'] + 1) % 24)}"
    opps = []
    for c in over:
        opps.append(opportunity(f"staffing.over.{c['wd']}.{c['hour']}", "staffing.over", "staffing", f"{name(c)}: {c['gap']:.1f} more people than the sales need → ≈ {money(c['monthly'])}/month", f"Trim {max(1, round(c['gap']))} {'person' if max(1, round(c['gap'])) == 1 else 'people'} from {name(c)} (start later or cut earlier).", c["monthly"], c["monthly"] * 0.6, c["monthly"], conf["score"] * 0.9,
                                [f"That hour averages {money(c['sales'])} of sales with {c['laborHours']:.1f} people on the clock ({money(c['splh'] or 0)} per labor hour vs your usual {money(meta['splh'])}). The sales need about {c['need']:.1f} (never fewer than {min_crew:.0f}).", f"Based on {c['n']} weeks; the gap is shrunk a little because a few weeks can mislead."],
                                [inp("Sales in the hour", money(c["sales"])), inp("People on the clock", f"{c['laborHours']:.1f}"), inp("Usual sales per labor hour", money(meta["splh"])), inp("Average loaded wage", money(meta["wage"], True)), inp("Weeks", c["n"])], href="/schedule", subject=f"{c['wd']}.{c['hour']}"))
    for c in under:
        c["monthly"] = abs(c["monthly"])
    total = sum(o["monthly"] for o in opps)
    if over:
        headline = f"{name(over[0])} has {over[0]['gap']:.1f} more people than its sales need — about {money(over[0]['monthly'])}/month"
        action = opps[0]["action"] + (f" And {name(under[0])} is running thin: {money(under[0]['splh'] or 0)} per labor hour." if under else "")
    elif under:
        headline = f"{name(under[0])} is under-staffed: people handle {money(under[0]['splh'] or 0)} an hour vs {money(meta['splh'])} usual"
        action = f"Add a person around {name(under[0])}."
    else:
        headline = "Staffing tracks sales well hour by hour"
        action = "Nothing to change."
    hours = sorted({c["hour"] for c in selling})
    wds = sorted({c["wd"] for c in selling})
    how = [
        f"We split every timecard into clock hours and lined them up with Square's hourly sales, then averaged each weekday × hour over the weeks we have (about {weeks:.0f}).",
        f"Your usual pace is {money(meta['splh'])} of sales per labor hour. An hour 'needs' its sales ÷ that pace, but never fewer than {min_crew:.0f} people while you're open.",
        f"Over-staffed hours cost the extra people × {money(meta['wage'], True)} an hour (average wage with employer taxes) × 4.3 weeks. Under-staffed hours aren't a saving — they're where service and upselling suffer.",
        "Hours before opening and after close (prep, cleaning) have labor but no sales, so they're left out here.",
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
        inputs=[inp(name(c), f"{money(c['sales'])} sales, {c['laborHours']:.1f} on the clock, need {c['need']:.1f}") for c in over + under],
        chart={"type": "heatmap", "rows": [WEEKDAY_SHORT[w] for w in wds], "cols": [hour_label(h) for h in hours], "cells": [{"r": wds.index(c["wd"]), "c": hours.index(c["hour"]), "splh": round(c["splh"] or 0, 0), "sales": round(c["sales"], 0), "people": round(c["laborHours"], 1), "flag": "over" if c in over else "under" if c in under else None} for c in selling], "splh": round(meta["splh"], 0)},
        details={"over": over, "under": under, "splh": meta["splh"], "wage": meta["wage"]},
        opportunities=opps,
    )
