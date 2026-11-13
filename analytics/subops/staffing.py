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

from .context import day_context, evidence, row, sure_line, week_monday
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


def grid(hourly: list[dict], min_weeks: int = 3, min_crew: float = 2.0, windows: dict | None = None) -> tuple[list[dict], dict]:
    """Per weekday × hour, week by week. Each week an hour 'needs' its sales ÷ that week's own pace
    (sales per labor hour across the service hours of that week — so a slow autumn week isn't held
    to a busy summer pace), never fewer than the minimum crew (+1 in the first and last hour)."""
    week_s: dict[str, float] = defaultdict(float)
    week_h: dict[str, float] = defaultdict(float)
    for r in hourly:
        if (r.get("sales") or 0) > 0:
            k = week_monday(r["date"])
            week_s[k] += float(r["sales"])
            week_h[k] += float(r.get("laborHours") or 0)
    cells: dict[tuple[int, int], list[tuple[float, float, float, float, str]]] = defaultdict(list)
    tot_s = sum(week_s.values())
    tot_h = sum(week_h.values())
    splh = tot_s / tot_h if tot_h else 0.0
    all_h = sum(float(r.get("laborHours") or 0) for r in hourly)
    all_c = sum(float(r.get("laborCost") or 0) for r in hourly)
    wage = all_c / all_h if all_h and all_c else 18.0
    for r in hourly:
        if (r.get("sales") or 0) <= 0 and (r.get("laborHours") or 0) <= 0:
            continue
        wd, h = weekday(r["date"]), int(r["hour"])
        k = week_monday(r["date"])
        pace = week_s[k] / week_h[k] if week_h.get(k) else splh
        pace = pace if pace > 0 else splh
        w = (windows or {}).get(wd)
        edge = 1.0 if w and h in (w[0], w[1] - 1) else 0.0
        s = float(r.get("sales") or 0)
        need = (max(min_crew, s / pace) if pace else float(r.get("laborHours") or 0)) + edge
        cells[(wd, h)].append((s, float(r.get("laborHours") or 0), float(r.get("laborCost") or 0), need, r["date"]))
    out = []
    for (wd, h), v in cells.items():
        n = len(v)
        if n < min_weeks:
            continue
        s = float(np.mean([x[0] for x in v]))
        lh = float(np.mean([x[1] for x in v]))
        need = float(np.mean([x[3] for x in v]))
        over_weeks = sum(1 for x in v if x[0] > 0 and x[1] > x[3] + 0.5)
        recent = sorted(v, key=lambda x: x[4])[-8:]
        out.append({"wd": wd, "hour": h, "n": n, "sales": s, "laborHours": lh, "splh": s / lh if lh > 0 else None, "overWeeks": over_weeks, "need": need, "recentOver": sum(1 for x in recent if x[0] > 0 and x[1] > x[3] + 0.5), "recentN": len(recent), "rows": [(x[0], x[1]) for x in v]})
    return out, {"splh": splh, "wage": wage, "hours": tot_h, "sales": tot_s, "weeks": len(week_s)}


def comparable_people(cells: list[dict], c: dict) -> tuple[float | None, int]:
    """What you usually have on in other hours (other days or parts of the day) that bring in about the
    same sales (±25%): the venue's own habit for an hour this busy."""
    lo, hi = c["sales"] * 0.75, c["sales"] * 1.25
    me = slot_key(c["wd"], c["hour"])
    v = [lh for o in cells if slot_key(o["wd"], o["hour"]) != me for s, lh in o["rows"] if lo <= s <= hi and s > 0]
    return (float(np.median(v)), len(v)) if len(v) >= 12 else (None, len(v))


def assess(cells: list[dict], meta: dict, min_crew: float = 2.0, windows: dict | None = None) -> list[dict]:
    """The gap is the smaller of two yardsticks — people over what the sales need at that week's pace,
    and people over what comparable hours usually get — shrunk toward zero with few weeks (n/(n+2))."""
    for c in cells:
        comp, n_comp = comparable_people(cells, c) if c["sales"] > 0 else (None, 0)
        c["comparable"] = comp
        c["comparableN"] = n_comp
        over_need = c["laborHours"] - c["need"]
        raw = min(over_need, c["laborHours"] - comp) if comp is not None else over_need * 0.5
        c["rawGap"] = over_need
        c["gap"] = raw * c["n"] / (c["n"] + 2)
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


def _block_numbers(blk: list[dict]) -> dict:
    n = min(c["n"] for c in blk)
    comp = [c["comparable"] for c in blk if c.get("comparable") is not None]
    return {
        "sales": sum(c["sales"] for c in blk) / len(blk),
        "on": sum(c["laborHours"] for c in blk) / len(blk),
        "need": sum(c["need"] for c in blk) / len(blk),
        "comp": sum(comp) / len(comp) if comp else None,
        "compN": min((c.get("comparableN") or 0) for c in blk),
        "n": n,
        "steady": min(c["overWeeks"] for c in blk),
        "recent": min(c["recentOver"] for c in blk),
        "recentN": min(c["recentN"] for c in blk),
    }


def _evidence(wd: int, hrs: list[int], b: dict, meta: dict, monthly: float, excluded: list[str], verdict: str, watch: str | None = None) -> dict:
    span = hours_span(hrs)
    day = WEEKDAYS[wd]
    rows = [
        row(f"Sales an hour, {day}s {span}", value=money(b["sales"])),
        row("People on the clock (average)", value=f"{b['on']:.1f}", strong=True),
        row("People those sales need at that week's own pace", value=f"{b['need']:.1f}", note=f"your pace across the week: about {money(meta['splh'])} of sales per person-hour; never fewer than the minimum crew"),
    ]
    if b["comp"] is not None:
        rows.append(row("What other hours with about the same sales usually get", value=f"{b['comp']:.1f} people", note=f"{b['compN']} comparable hours on other days and times"))
    rows.append(row("Weeks it was over", value=f"{b['steady']} of {b['n']}"))
    rows.append(row("Of the last 8 weeks", value=f"{b['recent']} of {b['recentN']}"))
    rows.append(row("Wages a month on the extra people", value=money(monthly), strong=True))
    steps = [
        f"Each week we work out your own pace that week (sales per person-hour across all service hours), so a quiet autumn week isn't held to a busy summer pace. At that pace, {day}s {span} need about {b['need']:.1f} people; you average {b['on']:.1f}.",
        (f"Hours on other days that bring in about the same ({money(b['sales'])} an hour) usually have {b['comp']:.1f} people on — so it's not just that small hours always need a minimum crew." if b["comp"] is not None else "There aren't enough other hours this quiet to compare with, so we only count half the gap."),
        f"We count the smaller of the two gaps, shrunk a little for the number of weeks, at {money(meta['wage'], True)} an hour with taxes × 4.3 weeks a month.",
    ]
    level = ("high" if b["steady"] >= 0.75 * b["n"] and b["recent"] >= 0.75 * b["recentN"] else "medium") if verdict == "real" else "low"
    why = {"high": f"it happened in {b['steady']} of {b['n']} weeks, including {b['recent']} of the last {b['recentN']}.",
           "medium": f"it happened in {b['steady']} of {b['n']} weeks, but not every week.",
           "low": "it doesn't hold up once it's compared with how you staff other hours this quiet, or it hasn't happened lately."}[level]
    return evidence(verdict=verdict, summary=f"{day}s {span}: {b['on']:.1f} people on for {money(b['sales'])} an hour — " + (f"more than that week's pace needs ({b['need']:.1f}) and more than hours this quiet usually get." if verdict == "real" else "more than the pace needs, but not more than you usually put on for hours this quiet."),
                    rows=rows, steps=steps, excluded=excluded, method="Each hour's sales and timecards over the last 26 weeks, against that week's own pace and against other hours with similar sales; event days and holidays left out.",
                    sure=sure_line(level, why), watch=watch,
                    chart={"type": "compare", "unit": "people", "rows": [{"label": "On the clock", "value": round(b["on"], 1), "tone": "bad" if verdict == "real" else None}, {"label": "Needed at that week's pace", "value": round(b["need"], 1)}] + ([{"label": "Hours this quiet usually get", "value": round(b["comp"], 1)}] if b["comp"] is not None else [])})


def run(data: dict) -> dict:
    hourly_all = recent_hourly(data)
    windows = open_windows(data, hourly_all)
    dctx = day_context(data)
    # Only service hours are judged: setup before opening and cleanup after close are expected labor.
    hourly = [r for r in hourly_all if in_service(windows, weekday(r["date"]), int(r["hour"]))] if windows else hourly_all
    # Event days, holidays and short days aren't how a normal week runs.
    unfair = sorted({r["date"] for r in hourly if dctx.special(r["date"]) in ("event", "holiday", "short")})
    hourly = [r for r in hourly if r["date"] not in set(unfair)]
    excluded = dctx.excluded_summary(unfair)
    min_crew = float(data.get("minCrew") or 2)
    cells, meta = grid(hourly, min_crew=min_crew, windows=windows)
    weeks = min(RECENT_WEEKS, len({r["date"] for r in hourly}) / 6) if hourly else 0
    if len(cells) < 10 or meta["hours"] <= 0:
        return insight("staffing", "Staffing by hour", status="thin", headline="Needs 3 weeks of hourly sales and timecards.", action="Keep Square connected and have the team clock in on Square — this fills in on its own.", how=["Each hour of the week needs at least 3 weeks of sales and timecards behind it."], details={"needs": ["timecards"]})
    assess(cells, meta, min_crew, windows)
    selling = [c for c in cells if c["sales"] > 0]
    over_cells = [c for c in selling if c["gap"] > 0.5]
    # Raw over the pace but not over what comparable hours get: watched, not flagged.
    raw_over = [c for c in selling if c["rawGap"] * c["n"] / (c["n"] + 2) > 0.5 and c not in over_cells]
    under = sorted([c for c in selling if c["rawGap"] < -0.5 and c["laborHours"] > 0], key=lambda c: c["rawGap"])[:3]
    conf = confidence(int(weeks * 7), 0.05)
    opps, watching = [], []
    groups = []
    for blk in blocks(over_cells):
        wd = blk[0]["wd"]
        monthly = sum(c["monthly"] for c in blk)
        hrs = [c["hour"] for c in blk]
        b = _block_numbers(blk)
        # Only steady, current, material gaps: most weeks over, still happening lately, worth $60+ a month.
        steady_ok = min(c["overWeeks"] / max(1, c["n"]) for c in blk) >= 0.5
        recent_ok = b["recent"] >= 0.5 * b["recentN"]
        if monthly < 60 or not steady_ok or not recent_ok:
            if monthly >= 30:
                why = "it hasn't happened in most of the last 8 weeks" if not recent_ok else "it only happens some weeks" if not steady_ok else "it's worth under $60 a month"
                watch = f"It would count if it happens in most weeks again (it's {b['recent']} of the last {b['recentN']})." if not recent_ok else f"It would count if it's over in most weeks (it's {b['steady']} of {b['n']})." if not steady_ok else "It would count if the gap grows past about $60 a month."
                o = opportunity(f"staffing.over.{wd}.{hrs[0]}", "staffing.over.watch", "staffing", f"{WEEKDAYS[wd]} {daypart(hrs[0])} sometimes has more people on than it needs", "Nothing to do yet — we're watching it.", 0.0, 0.0, 0.0, 0.2, [f"Not flagged because {why}."], href="/schedule", subject=f"{wd}.{hrs[0]}", area="staffing", effort="easy", vector="info")
                o["evidence"] = _evidence(wd, hrs, b, meta, monthly, excluded, "unclear", watch)
                o["status"], o["watch"] = "watching", watch
                watching.append(o)
            continue
        span = hours_span(hrs)
        extra = max(c["gap"] for c in blk)
        people = max(1, round(extra))
        sales, on, need, n, steady = b["sales"], b["on"], b["need"], b["n"], b["steady"]
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
        comp_txt = f" Other hours that bring in about the same usually have {b['comp']:.1f} on." if b["comp"] is not None else ""
        o = opportunity(
            f"staffing.over.{wd}.{hrs[0]}", "staffing.over", "staffing",
            f"{when} has more people on than it needs",
            f"{todo}.",
            monthly, monthly * 0.6, monthly, conf["score"] * (0.9 if steady >= n * 0.75 else 0.75),
            [f"From {span} on {WEEKDAYS[wd]}s you average {money(sales)} of sales an hour with {on:.1f} people on the clock. At each week's own pace that needs about {need:.1f} (never fewer than {min_crew:.0f}).{comp_txt}", f"Based on the last {n} {WEEKDAYS[wd]}s (event days and holidays left out); the gap is shrunk a little because a few weeks can mislead."],
            [inp("Sales per hour (avg)", money(sales)), inp("People on the clock", f"{on:.1f}"), inp("People the sales need", f"{need:.1f}"), inp("Comparable hours usually get", f"{b['comp']:.1f}" if b["comp"] is not None else "—"), inp("Usual sales per person per hour", money(meta["splh"])), inp("Average wage with taxes", money(meta["wage"], True)), inp("Weeks", n)],
            href="/schedule", subject=f"{wd}.{hrs[0]}",
            area="staffing", effort="easy", vector="save", group=grp,
            story=story(
                f"On {WEEKDAYS[wd]}s from {span} you average {money(sales)} of sales an hour with {on:.1f} people on the clock.",
                f"At each week's own pace these hours need about {need:.1f} people, and other hours this quiet usually get {b['comp']:.1f} — so roughly {plural(extra, 'person is', 'people are')} waiting for guests. It's been like this in {steady} of the last {n} {WEEKDAYS[wd]}s." if b["comp"] is not None else f"At each week's own pace these hours need about {need:.1f} people — so roughly {plural(extra, 'person is', 'people are')} waiting for guests. It's been like this in {steady} of the last {n} {WEEKDAYS[wd]}s.",
                f"{todo}. Keep at least {min_crew:.0f} on while you're open.",
                f"About {money(monthly)} a month in wages, with no change to what guests see.",
            ),
            visual=day_profile(cells, wd, set(hrs)),
        )
        o["evidence"] = _evidence(wd, hrs, b, meta, monthly, excluded, "real")
        opps.append(o)
    # Over the pace, but no more than you usually put on for hours this quiet: a habit across the week
    # (minimum crew), not this slot's problem — watched, with what would make it count.
    flagged = {o["subject"] for o in opps} | {w["subject"] for w in watching}
    for blk in blocks(raw_over):
        wd, hrs = blk[0]["wd"], [c["hour"] for c in blk]
        if f"{wd}.{hrs[0]}" in flagged:
            continue
        raw_monthly = sum(max(0.0, c["rawGap"]) * c["n"] / (c["n"] + 2) for c in blk) * meta["wage"] * WEEKS_PER_MONTH
        if raw_monthly < 50:
            continue
        b = _block_numbers(blk)
        watch = (f"It would count if these hours ran with more people than other hours this quiet get (about {b['comp']:.1f}); today they have {b['on']:.1f}." if b["comp"] is not None else "It would count with more weeks of comparable hours to check it against.")
        o = opportunity(f"staffing.over.{wd}.{hrs[0]}", "staffing.over.watch", "staffing", f"{WEEKDAYS[wd]} {daypart(hrs[0])} looks over-staffed on paper", "Nothing to do — it's staffed like your other quiet hours.", 0.0, 0.0, 0.0, 0.2, [f"More people than the sales need at that week's pace, but no more than you usually put on for hours this quiet (worth about {money(raw_monthly)} a month on paper)."], href="/schedule", subject=f"{wd}.{hrs[0]}", area="staffing", effort="easy", vector="info")
        o["evidence"] = _evidence(wd, hrs, b, meta, raw_monthly, excluded, "unclear", watch)
        o["status"], o["watch"] = "watching", watch
        watching.append(o)
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
        f"We split every timecard into clock hours and lined them up with Square's sales for that hour, then looked at each weekday and hour over the last {weeks:.0f} weeks (schedules change, so older weeks would mislead). Event days and holidays are left out.",
        f"Each week has its own pace (sales per person per hour across that week — about {money(meta['splh'])} on average), so a slow season isn't judged against a busy one. An hour 'needs' its sales ÷ that week's pace, but never fewer than {min_crew:.0f} people while you're open.",
        "An hour only counts as over-staffed if it also has more people than you usually put on for other hours with about the same sales, it happened most weeks, and it's still happening lately.",
        f"Extra people cost their hours × {money(meta['wage'], True)} (average wage with employer taxes) × 4.3 weeks a month. Short-handed hours aren't a saving — they're where service and upselling suffer.",
        "Setup before you open and cleanup after you close are expected, so those hours are never judged — only the hours you're serving guests" + (" (" + ", ".join(f"{WEEKDAY_SHORT[w]} {hour_label(a)}–{hour_label(b)}" for w, (a, b) in sorted(windows.items())) + ")" if windows else "") + ".",
    ]
    strip = lambda c: {k: v for k, v in c.items() if k != "rows"}
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
        details={"windows": {str(k): list(v) for k, v in windows.items()}, "over": [strip(c) for c in sorted(over_cells, key=lambda c: -c["gap"])[:6]], "under": [strip(c) for c in under], "splh": meta["splh"], "wage": meta["wage"], "groups": groups, "weeks": weeks, "excluded": excluded, "cells": [{k: c[k] for k in ("wd", "hour", "sales", "laborHours", "need", "n")} for c in selling]},
        opportunities=opps,
        watching=watching,
        evidence=opps[0]["evidence"] if opps else None,
    )
