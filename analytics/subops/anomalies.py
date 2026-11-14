"""Unusual days.

Each daily measure is compared with what's normal for that kind of day:
- sales: log(sales ÷ planned event impact), seasonal-trend decomposition
  (STL, robust, one season = one week of open days) when there are 4+ weeks,
  otherwise the same-weekday median; the leftover is what's unusual;
- labor %: against the same-weekday median;
- food cost %: against the overall median (it barely depends on weekday);
- waste $: against the median day, once waste has been logged for 2+ weeks.

Leftovers are scored with a robust z-score ((x − median) ÷ 1.4826·MAD), so one
crazy day can't hide another. |z| ≥ 3 is unusual; 2.5–3 is "worth a look".
(In the app this is "how far from a normal day", never a z-score.)

One-off days are things to know, not actions. The action is the pattern: on
slow days (sales well under normal) is the crew cut back? `slow_days` prices the
hours that weren't, over the last 26 weeks.
"""

from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd

from .context import DayContext, day_context, evidence, holiday, holidays, pct_words, row, sure_line
from .common import WEEKDAYS, WEEKS_PER_MONTH, add_days, confidence, inp, insight, money, opportunity, plural, robust_z, story, weekday

LOOKBACK = 14


def _wet_effect(dctx: DayContext) -> tuple[float, int, int] | None:
    """Rain's effect on a day's sales vs its weekday's recent level, from the days with weather on record."""
    wet, dry = [], []
    for k in dctx.dates:
        x = dctx.days[k]
        if not x.get("hasWeather") or not dctx.fair(k):
            continue
        base, _ = dctx.recent_level(k, "sales", lag=1, weeks=6)
        if not base:
            continue
        (wet if x.get("wet") else dry).append(math.log(x["sales"] / base))
    if len(wet) < 5 or len(dry) < 10:
        return None
    diff = float(np.mean(wet) - np.mean(dry))
    n = len(wet)
    return diff * n / (n + 5), len(wet), len(dry)


def expected_sales(dctx: DayContext, k: str, wet_eff: tuple | None) -> dict | None:
    """What a day 'should' have done: the same weekday over the 6 weeks before (fair days only),
    moved the way last year moved into this week, × planned event impact, × rain when it rained
    and rain's effect is known. Holidays are compared with the same holiday last year."""
    base, n = dctx.recent_level(k, "sales", lag=1, weeks=6)
    if not base:
        return None
    x = dctx.days[k]
    parts = {"base": base, "n": n, "season": dctx.season_ratio(k, lag=1, weeks=6), "event": None, "rain": None, "holiday": None}
    exp = base * (parts["season"] or 1.0)
    if x.get("eventKinds") and (x.get("eventMult") or 1) > 0:
        parts["event"] = float(x["eventMult"])
        exp *= parts["event"]
    if wet_eff and x.get("hasWeather") and x.get("wet"):
        parts["rain"] = math.exp(wet_eff[0])
        exp *= parts["rain"]
    hol = holiday(k)
    if hol:
        # Compared with the most recent year the same holiday fell on the same weekday (a Friday
        # Halloween is not a Saturday one). None in the history → we can't say what's normal: not judged.
        ly = None
        for back in range(1, 8):
            cand = next((dd for dd, nm in holidays(int(k[:4]) - back).items() if nm == hol), None)
            if cand and weekday(cand) == weekday(k) and cand in dctx.open:
                ly = cand
                break
        if not ly:
            return None
        b_ly, _ = dctx.recent_level(ly, "sales", lag=1, weeks=6)
        if not b_ly:
            return None
        parts["holiday"] = (hol, float(np.clip(dctx.days[ly]["sales"] / b_ly, 0.3, 3.0)))
        exp *= parts["holiday"][1]
    parts["expected"] = exp
    return parts


def expected_hours(dctx: DayContext, k: str) -> dict | None:
    """Paid hours a day like this usually gets: the weekday's recent typical hours, half fixed (you need
    people to open) and half following that day's sales."""
    h, n = dctx.recent_level(k, "laborHours", lag=1, weeks=6)
    s, _ = dctx.recent_level(k, "sales", lag=1, weeks=6)
    if not h or not s:
        return None
    x = dctx.days[k]
    ratio = x["sales"] / s
    return {"typical": h, "typicalSales": s, "expected": h * (0.5 + 0.5 * ratio), "n": n}


def _day_name(k: str) -> str:
    t = pd.Timestamp(k)
    return f"{WEEKDAYS[t.weekday()]} {t.strftime('%b')} {t.day}"


def _sales_evidence(k: str, x: dict, e: dict, z: float, scale: float, as_of: str) -> dict:
    wd = WEEKDAYS[weekday(k)]
    rows = [row("Sales that day", value=money(x["sales"]), strong=True), row(f"A normal {wd} lately", value=money(e["base"]), note=f"median of the {e['n']} {wd}s in the 6 weeks before (events and holidays left out)")]
    steps = [f"Your last {e['n']} normal {wd}s did about {money(e['base'])}."]
    if e["season"]:
        rows.append(row("Last year, this week vs the weeks before", value=pct_words(e["season"] - 1)))
        steps.append(f"Last year this week ran {pct_words(e['season'] - 1)} against the weeks before it, so we expect the same seasonal move now.")
    if e["event"]:
        rows.append(row("Planned event impact", value=f"×{e['event']:.2f}"))
        steps.append(f"There was an event planned at ×{e['event']:.2f}, so that's built in.")
    if e["rain"]:
        rows.append(row("It rained", value=pct_words(e["rain"] - 1), note="what rain usually does to your sales"))
        steps.append(f"It rained, which usually means {pct_words(e['rain'] - 1)}.")
    if e["holiday"]:
        rows.append(row(f"{e['holiday'][0]} last year vs a normal day", value=pct_words(e["holiday"][1] - 1)))
        steps.append(f"It was {e['holiday'][0]}; last year that ran {pct_words(e['holiday'][1] - 1)} against a normal day.")
    gap = x["sales"] - e["expected"]
    rows.append(row("Expected for that day", value=money(e["expected"]), strong=True))
    rows.append(row("Difference", value=f"{'+' if gap >= 0 else '−'}{money(abs(gap))} ({pct_words(x['sales'] / e['expected'] - 1)})", strong=True))
    steps.append(f"So we expected about {money(e['expected'])}; it did {money(x['sales'])}.")
    one_in = _one_in(z)
    return evidence(verdict="info", summary=f"{_day_name(k)} did {money(x['sales'])} against about {money(e['expected'])} expected for that day — {pct_words(x['sales'] / e['expected'] - 1)}.", rows=rows, steps=steps,
                    method="Expected = the same weekday over the 6 weeks before × how last year moved into this week × events, rain and holidays where known.",
                    sure=sure_line("high" if abs(z) >= 3 else "medium", f"a normal day lands this far from what we expect about 1 time in {one_in} (your days usually land within about {pct_words(math.exp(scale) - 1).lstrip('+')} of expected)."),
                    chart={"type": "compare", "unit": "money", "rows": [{"label": "Expected", "value": round(e["expected"])}, {"label": "Actual", "value": round(x["sales"]), "tone": "good" if gap > 0 else "bad"}]})


def _one_in(z: float) -> int:
    from scipy.stats import norm

    p = 2 * (1 - norm.cdf(abs(z)))
    return int(round(1 / max(p, 1e-4), -1)) or 10


def scores(days: list[dict], as_of: str, data: dict | None = None) -> list[dict]:
    """Unusual days in the last 14, each against what was expected for that date (weekday, time of
    year, events, rain, holidays) — not against an average day of the year."""
    data = data if data is not None else {"days": days, "asOf": as_of}
    dctx = day_context(data)
    open_k = [k for k in dctx.dates if k in dctx.open]
    if len(open_k) < 14:
        return []
    wet_eff = _wet_effect(dctx)
    hist_from = add_days(as_of, -365)
    resid, h_resid = {}, {}
    exps, hexps = {}, {}
    for k in open_k:
        if k < hist_from:
            continue
        e = expected_sales(dctx, k, wet_eff)
        if e and e["expected"] > 0:
            exps[k] = e
            resid[k] = math.log(dctx.days[k]["sales"] / e["expected"])
        if (dctx.days[k].get("laborHours") or 0) > 0 and not dctx.special(k):
            he = expected_hours(dctx, k)
            if he and he["expected"] > 0:
                hexps[k] = he
                h_resid[k] = dctx.days[k]["laborHours"] / he["expected"] - 1
    out = []
    since = add_days(as_of, -LOOKBACK)
    if len(resid) >= 14:
        z = dict(zip(resid, robust_z(list(resid.values()))))
        r = np.array(list(resid.values()))
        scale = float(np.median(np.abs(r - np.median(r))) * 1.4826) or 0.1
        for k in resid:
            if k < since or abs(z[k]) < 2.5:
                continue
            x, e = dctx.days[k], exps[k]
            gap = x["sales"] - e["expected"]
            ev = f" ({', '.join(x.get('eventTitles') or [])})" if x.get("eventTitles") else ""
            when = "for that day" if not (e["season"] or e["rain"] or e["holiday"] or e["event"]) else "for that date (weekday, time of year" + (", rain" if e["rain"] else "") + (", event" if e["event"] else "") + (", holiday" if e["holiday"] else "") + ")"
            out.append({"date": k, "metric": "sales", "z": float(z[k]), "dollars": float(gap), "normal": float(e["expected"]), "actual": float(x["sales"]), "text": f"{_day_name(k)}: sales {money(x['sales'])}, about {money(abs(gap))} {'more' if gap > 0 else 'less'} than expected {when}{ev}", "action": "Worth knowing why — something to repeat?" if gap > 0 else "Weather, a closure, or a quiet week in town? Nothing to fix if you know why.", "method": "expected for the date", "evidence": _sales_evidence(k, x, e, float(z[k]), scale, as_of)})
    if len(h_resid) >= 14:
        hz = dict(zip(h_resid, robust_z(list(h_resid.values()))))
        hourly_cost = sum(float(dctx.days[k].get("labor") or 0) for k in h_resid) / max(1e-9, sum(float(dctx.days[k]["laborHours"]) for k in h_resid)) or 20.0
        for k in h_resid:
            if k < since or hz[k] < 2.5:
                continue
            x, he = dctx.days[k], hexps[k]
            extra_h = x["laborHours"] - he["expected"]
            if extra_h < 3:
                continue
            shifts = extra_h / 6
            who = f"about {plural(shifts, 'extra shift')}" if shifts >= 0.75 else f"about {plural(extra_h, 'extra hour')}"
            wd = WEEKDAYS[weekday(k)]
            ev = evidence(verdict="info", summary=f"{_day_name(k)} had {x['laborHours']:.0f} paid hours; a {wd} with those sales usually gets about {he['expected']:.0f}.",
                          rows=[row("Paid hours that day", value=f"{x['laborHours']:.1f}", strong=True), row(f"A normal {wd} lately", value=f"{he['typical']:.1f} hours for {money(he['typicalSales'])} of sales"), row("That day's sales", value=money(x["sales"])), row("Hours a day with those sales usually gets", value=f"{he['expected']:.1f}", note="half the crew is fixed, half follows sales"), row("Extra", value=f"{extra_h:.1f} hours ≈ {money(extra_h * hourly_cost)}", strong=True)],
                          steps=[f"We compare paid hours with what your recent {wd}s got, adjusted for that day's sales, rather than wages as a share of sales — on a slow day that share jumps even when nobody extra came in."],
                          method="Paid hours against the same weekday over the 6 weeks before, with half the crew fixed and half following that day's sales.",
                          sure=sure_line("high" if hz[k] >= 3 else "medium", f"a normal day has this many extra hours about 1 time in {_one_in(hz[k])}."),
                          chart={"type": "compare", "unit": "hours", "rows": [{"label": "Usual for those sales", "value": round(he["expected"], 1)}, {"label": "Paid that day", "value": round(x["laborHours"], 1), "tone": "bad"}]})
            out.append({"date": k, "metric": "labor", "z": float(hz[k]), "dollars": float(extra_h * hourly_cost), "text": f"{_day_name(k)}: {extra_h:.0f} more paid hours than a {wd} with those sales usually gets ({x['laborHours']:.0f} vs about {he['expected']:.0f}) — {who}", "action": "Check who stayed late or was called in.", "method": "hours for the sales", "evidence": ev})
    # food cost and waste: unchanged yardsticks (they barely depend on the day's traffic)
    rows = [{"date": k, "foodPct": (dctx.days[k].get("cogs") or 0) / dctx.days[k]["foodSales"] if dctx.days[k].get("foodSales") else np.nan, "waste": float(dctx.days[k].get("waste") or 0) if dctx.days[k].get("wasteLogged") else np.nan, "sales": dctx.days[k]["sales"]} for k in open_k]
    df = pd.DataFrame(rows)
    fp = df.dropna(subset=["foodPct"])
    if len(fp) >= 14:
        fz = robust_z(fp["foodPct"])
        normal = float(fp["foodPct"].median())
        for (_, r), zz in zip(fp.iterrows(), fz):
            if r["date"] >= since and abs(zz) >= 3:
                out.append({"date": r["date"], "metric": "food", "z": float(zz), "dollars": float((r["foodPct"] - normal) * r["sales"]), "text": f"{_day_name(r['date'])} food cost was {round((r['foodPct'] - normal) * 100)} points {'above' if zz > 0 else 'below'} normal", "action": "Usually the item mix — check what sold that day.", "method": "overall median"})
    wp = df.dropna(subset=["waste"])
    if len(wp) >= 14:
        wz = robust_z(wp["waste"])
        normal = float(wp["waste"].median())
        for (_, r), zz in zip(wp.iterrows(), wz):
            if r["date"] >= since and zz >= 3:
                out.append({"date": r["date"], "metric": "waste", "z": float(zz), "dollars": float(r["waste"] - normal), "text": f"{_day_name(r['date'])} waste was {money(r['waste'])} vs {money(normal)} on a normal day", "action": "Look at what was logged — over-prep or a delivery problem?", "method": "overall median"})
    # One line per day: a slow day with normal wages is one story, not two.
    by_date: dict[str, list[dict]] = {}
    for a in out:
        by_date.setdefault(a["date"], []).append(a)
    merged = []
    for date_, xs in by_date.items():
        sales = next((a for a in xs if a["metric"] == "sales"), None)
        labor = next((a for a in xs if a["metric"] == "labor"), None)
        if sales and labor and sales["dollars"] < 0:
            sales = {**sales, "text": sales["text"] + " — and wages weren't cut back to match", "related": "labor"}
            merged.append(sales)
            merged += [a for a in xs if a["metric"] not in ("sales", "labor")]
        else:
            merged += xs
    merged.sort(key=lambda a: -abs(a["dollars"]))
    return merged


def slow_days(data: dict, weeks: int = 26) -> dict | None:
    """On slow days (under 70% of a normal day for that weekday at that time of year), how many paid
    hours weren't trimmed — judged against what you could have known.

    Trimmed day: half the crew is fixed (you need people to open), half follows sales.
    - Foreseeable slow: the forecast a week ahead (same weekday over the 8 weeks before, moved the
      way last year moved into this week) already said it'd be quiet → the schedule should have been
      lighter: all the extra hours count.
    - A surprise: the forecast said a normal day → only sending someone home mid-shift was possible,
      so only half the extra hours count."""
    as_of = data["asOf"]
    dctx = day_context(data)
    since = add_days(as_of, -7 * weeks)
    min_crew = float(data.get("minCrew") or 2)
    days = [dctx.days[k] for k in dctx.dates if k >= since and k in dctx.open and (dctx.days[k].get("laborHours") or 0) > 0 and dctx.special(k) is None]
    if len(days) < 40:
        return None
    rate = sum(x["labor"] for x in days) / sum(x["laborHours"] for x in days)
    slow, extra_hours, counted_hours = [], 0.0, 0.0
    skipped_season = 0
    for x in days:
        k = x["date"]
        normal_s = dctx.normal(k, "sales", span=28)
        normal_h = dctx.normal(k, "laborHours", span=28)
        if not normal_s or not normal_h:
            continue
        ratio = x["sales"] / normal_s
        if ratio >= 0.7:
            # Under a 26-week median but normal for the time of year → not a slow day.
            continue
        trimmed = max(min_crew * 4, normal_h * (0.5 + 0.5 * ratio))
        ex = max(0.0, x["laborHours"] - trimmed)
        fc = dctx.expected_ahead(k)
        foreseen = bool(fc and fc["expected"] < 0.8 * normal_s)
        if fc:
            planned = max(min_crew * 4, normal_h * (0.5 + 0.5 * min(1.0, fc["expected"] / normal_s)))
            sched_part = max(0.0, x["laborHours"] - max(planned, trimmed)) if not foreseen else ex
        else:
            sched_part = 0.0
        surprise_part = ex - sched_part
        counted = sched_part + 0.5 * surprise_part
        slow.append({"date": k, "wd": weekday(k), "sales": x["sales"], "normal": normal_s, "hours": x["laborHours"], "normalHours": normal_h, "extra": ex, "counted": counted, "foreseen": foreseen, "forecast": fc["expected"] if fc else None})
        extra_hours += ex
        counted_hours += counted
    trimmed_days = [s for s in slow if s["extra"] <= 0.5]
    if len(slow) < 6:
        return None
    monthly = counted_hours * rate / weeks * WEEKS_PER_MONTH
    raw_monthly = extra_hours * rate / weeks * WEEKS_PER_MONTH
    worst_wd = max(set(s["wd"] for s in slow), key=lambda w: sum(s["counted"] for s in slow if s["wd"] == w))
    per_slow = extra_hours / len(slow)
    ws = [s for s in slow if s["wd"] == worst_wd]
    n_fore = sum(1 for s in slow if s["foreseen"])
    rows = [
        row(f"Slow days in the last {weeks} weeks", value=f"{len(slow)}", note="under 70% of a normal day for that weekday at that time of year"),
        row("Foreseeable a week ahead", value=f"{n_fore} of {len(slow)}", note="the forecast you'd have scheduled from already said it'd be quiet"),
        row("Already trimmed", value=f"{len(trimmed_days)} of {len(slow)}"),
        row("Paid hours over a trimmed day", value=f"{extra_hours:.0f} hours ({per_slow:.1f} a slow day)"),
        row("Hours we count", value=f"{counted_hours:.0f}", note="all of it when the slow day was foreseeable; half when it was a surprise (only a mid-shift cut was possible)", strong=True),
        row("Average wage with taxes", value=money(rate, True)),
        row("A month", value=money(monthly), strong=True),
    ]
    ev = evidence(
        verdict="real" if monthly >= 60 else "unclear",
        summary=f"On {len(slow)} days that ran well under a normal day for the time of year, the crew mostly stayed the same. {n_fore} of them were foreseeable when the schedule was written.",
        rows=rows,
        steps=[
            "A 'normal day' is the median of the same weekday within four weeks either side, so a quiet November Thursday isn't compared with a busy August one.",
            "For each slow day we asked what a forecast made a week ahead would have said (the same weekday over the 8 weeks before, moved the way last year moved into that week). If it already said quiet, the schedule should have been lighter: all the extra hours count.",
            "If the forecast said a normal day, nobody could have scheduled for it — only sending someone home once it was clearly quiet was possible, so we count half.",
            "A trimmed day keeps half the crew (you need people to open) and lets the other half follow sales.",
        ],
        excluded=["event days, holidays and short days (closed early, storms)"],
        method="Slow days against the same weekday nearby, with the extra hours split into what the schedule could have known and what only a mid-shift call could fix.",
        sure=sure_line("medium" if len(slow) >= 10 else "low", f"it's {len(slow)} days over {weeks} weeks, and the half-fixed crew is a rule of thumb, not your exact rota."),
        chart={"type": "compare", "unit": "hours", "rows": [{"label": f"Paid hours, a normal {WEEKDAYS[worst_wd]}", "value": round(ws[0]["normalHours"], 1)}, {"label": f"A slow {WEEKDAYS[worst_wd]} (median)", "value": round(float(np.median([s['hours'] for s in ws])), 1), "tone": "bad"}, {"label": f"A slow {WEEKDAYS[worst_wd]}, trimmed", "value": round(float(np.median([s['hours'] - s['extra'] for s in ws])), 1), "tone": "good"}]},
        watch=None if monthly >= 60 else "It would count if slow days keep getting a full crew and the hours we can fairly count pass about $60 a month.",
    )
    if monthly < 60:
        o = opportunity("anomaly.slowdays", "anomaly.slowdays.watch", "anomalies", "Slow days sometimes keep a full crew", "Nothing to do yet — we're watching it.", 0.0, 0.0, 0.0, 0.2, [ev["summary"]], href="/schedule", subject="slowdays", area="staffing", effort="easy", vector="info")
        o["evidence"], o["status"], o["watch"] = ev, "watching", ev["watch"]
        return o
    o = opportunity(
        "anomaly.slowdays", "anomaly.slowdays", "anomalies",
        "Slow days still get a full crew",
        f"When it's quiet by mid-shift, send one person home early — {WEEKDAYS[worst_wd]}s most of all." + (" And when the week ahead looks quiet, schedule one fewer." if n_fore else ""),
        monthly, monthly * 0.5, max(monthly, raw_monthly), 0.55,
        [f"In the last {weeks} weeks, {len(slow)} open days ran under 70% of a normal day for that weekday at that time of year. On those days the team worked about {per_slow:.1f} more hours than a trimmed day would. We count all of it when the quiet day was foreseeable a week ahead, half when it was a surprise."],
        [inp("Slow days", len(slow)), inp("Foreseeable", n_fore), inp("Trimmed already", len(trimmed_days)), inp("Extra hours on slow days", f"{extra_hours:.0f}"), inp("Hours counted", f"{counted_hours:.0f}"), inp("Average wage with taxes", money(rate, True))],
        href="/schedule", subject="slowdays", area="staffing", effort="easy", vector="save",
        story=story(
            f"{len(slow)} days in the last {weeks} weeks ran well under a normal day for the time of year — like a {WEEKDAYS[worst_wd]} doing a third less than usual.",
            f"On those days the crew mostly stayed the same: about {per_slow:.1f} more paid hours than a trimmed day. Only {len(trimmed_days)} of {len(slow)} were cut back. {n_fore} of them were foreseeable when the schedule was written; for the rest we only count what a mid-shift call could have saved.",
            f"Check sales at the halfway point of a shift. If it's well under a normal {WEEKDAYS[worst_wd]}, send one person home.",
            f"About {money(monthly)} a month.",
        ),
        visual={"type": "compare", "unit": "number", "rows": [{"label": f"Paid hours, a normal {WEEKDAYS[worst_wd]}", "value": round(ws[0]["normalHours"], 1)}, {"label": f"A slow {WEEKDAYS[worst_wd]} (median)", "value": round(float(np.median([s['hours'] for s in ws])), 1), "tone": "bad"}, {"label": f"A slow {WEEKDAYS[worst_wd]}, trimmed", "value": round(float(np.median([s['hours'] - s['extra'] for s in ws])), 1), "tone": "good"}],
                # Each slow day, for the app's calendar (2.2+; older apps ignore it).
                "days": [{"date": s["date"], "foreseen": s["foreseen"], "trimmed": s["extra"] <= 0.5, "pct": round(s["sales"] / s["normal"], 2), "extra": round(s["extra"], 1)} for s in slow],
                "since": since, "through": as_of},
    )
    o["evidence"] = ev
    return o


def run(data: dict) -> dict:
    days = data.get("days", [])
    n_open = len([x for x in days if x.get("open")])
    found = scores(days, data["asOf"], data)
    if n_open < 14:
        return insight("anomalies", "Unusual days", status="thin", headline="Needs 2+ weeks of sales to know what's normal.", action="Nothing to do yet.", how=["An unusual day only stands out against a few weeks of normal ones."])
    waste_days = len([x for x in days if x.get("wasteLogged")])
    conf = confidence(n_open)
    how = [
        f"For every day in the last {LOOKBACK} days we compared sales, paid hours, food cost % and waste with what was expected for that date, using {n_open} open days of history.",
        "Expected sales: the same weekday over the 6 weeks before, moved the way last year moved into that week (the season), with planned events, rain (when the weather's on record) and holidays (against the same holiday last year) built in.",
        "Paid hours are compared with what that weekday usually gets for those sales — not wages as a share of sales, which jumps on any slow day even when nobody extra came in.",
        "A day only shows up when it's far further from expected than your ordinary day-to-day ups and downs — about 1 day in 80 would by chance.",
    ]
    if waste_days < 14:
        how.append(f"Waste isn't checked yet: it's been logged on {waste_days} days, and we need 14 to know a normal day.")
    sd = slow_days(data)
    watching = [sd] if sd and sd.get("status") == "watching" else []
    opps = [sd] if sd and sd.get("status") != "watching" else []
    if not found:
        return insight("anomalies", "Unusual days", headline=f"Nothing unusual in the last {LOOKBACK} days", action="Nothing to chase.", confidence=conf, how=how, inputs=[inp("Open days of history", n_open)], details={"items": []}, opportunities=opps, watching=watching)
    top = found[0]
    # One-off days are worth knowing, not actions; the pattern behind them is.
    return insight(
        "anomalies",
        "Unusual days",
        headline=top["text"],
        action=top["action"],
        confidence=conf,
        how=how,
        inputs=[inp(a["date"], a["text"].split(": ", 1)[-1]) for a in found[:8]],
        chart={"type": "list", "rows": [{"date": a["date"], "metric": a["metric"], "z": round(a["z"], 1), "text": a["text"]} for a in found[:5]]},
        details={"items": found[:8]},
        opportunities=opps,
        watching=watching,
        evidence=top.get("evidence"),
    )
