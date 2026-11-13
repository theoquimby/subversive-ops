"""Your week: what each weekday leaves after food & drink costs and wages.

Over the last 12 months (or the chosen range if shorter) of open days with
timecards: average sales, minus food and drink cost (measured, or a typical 30%
until plate costs are set up), minus wages. Rent and other fixed costs aren't
taken off — they're paid whether you open or not — so a weekday that's negative
here really costs money to open. A weekday that's negative only in winter
(Nov–Mar) is called out on its own.
"""

from __future__ import annotations

import numpy as np

from .context import day_context
from .common import WEEKDAYS, WEEKDAY_SHORT, WEEKS_PER_MONTH, add_days, confidence, cost_note, cost_share, inp, insight, money, open_days, opportunity, story, weekday


def _season(iso_date: str) -> str:
    m = int(iso_date[5:7])
    return "winter" if m in (11, 12, 1, 2, 3) else "summer"


def run(data: dict) -> dict:
    as_of = data["asOf"]
    since = add_days(as_of, -365)
    dctx = day_context(data)
    # Event days and holidays aren't what a normal Monday is like.
    days = [x for x in open_days(data.get("days", [])) if x["date"] >= since and (x.get("laborHours") or 0) > 0 and dctx.special(x["date"]) not in ("event", "holiday")]
    if len(days) < 28:
        return insight("week", "Your week", status="thin", headline="Needs a month of sales and timecards.", action="Have the team clock in and out on Square.", how=[], details={"needs": ["timecards"]})
    share, measured = cost_share(data)
    rows = []
    for wd in range(7):
        xs = [x for x in days if weekday(x["date"]) == wd]
        if len(xs) < 4:
            continue
        def stats(v):
            s = float(np.mean([x["sales"] for x in v]))
            lab = float(np.mean([x["labor"] for x in v]))
            cogs = float(np.mean([x["cogs"] for x in v])) if measured else s * share
            return {"sales": s, "labor": lab, "cogs": cogs, "left": s - cogs - lab, "n": len(v)}
        st = stats(xs)
        seasons = {k: stats([x for x in xs if _season(x["date"]) == k]) for k in ("winter", "summer") if len([x for x in xs if _season(x["date"]) == k]) >= 4}
        rows.append({"wd": wd, **st, "seasons": seasons})
    if not rows:
        return insight("week", "Your week", status="thin", headline="Needs a month of sales and timecards.", action="", how=[])
    best = max(rows, key=lambda r: r["left"])
    worst = min(rows, key=lambda r: r["left"])
    opps = []
    for r in rows:
        w = r["seasons"].get("winter")
        target, when = (r, f"{WEEKDAYS[r['wd']]}s") if r["left"] < 0 else ((w, f"{WEEKDAYS[r['wd']]}s from November to March") if w and w["left"] < 0 else (None, ""))
        if not target:
            continue
        loss = -target["left"]
        per_month = loss * WEEKS_PER_MONTH * (5 / 12 if target is w else 1)
        if per_month < 80:
            continue
        opps.append(opportunity(
            f"week.loss.{r['wd']}", "week.loss", "week",
            f"{when} cost more to open than they bring in",
            f"Try shorter hours on {when} (open later or close earlier), or run them with a smaller crew.",
            per_month, per_month * 0.4, per_month, 0.5 if target["n"] >= 12 else 0.35,
            [f"Over {target['n']} of them: about {money(target['sales'])} in sales, {money(target['cogs'])} in food and drink, {money(target['labor'])} in wages. Rent is left out — you pay it either way."],
            [inp("Days", target["n"]), inp("Sales (avg)", money(target["sales"])), inp("Wages (avg)", money(target["labor"])), inp("Food & drink" + ("" if measured else " (typical)"), money(target["cogs"]))],
            href="/schedule", subject=str(r["wd"]), area="hours", effort="hard", vector="save",
            story=story(
                f"An average {when.rstrip('s')} brings in {money(target['sales'])} and costs {money(target['labor'])} in wages.",
                f"After a {cost_note(measured, share)}, it's about {money(loss)} short each time — before rent, which you pay either way.",
                f"Try shorter hours on {when} for a month: open later, close earlier, or run it with a smaller crew. Closing the day is the last resort.",
                f"Up to {money(per_month)} a month; most of it from the quietest hours.",
            ),
            visual={"type": "week", "rows": [{"label": WEEKDAY_SHORT[x["wd"]], "value": round(x["left"]), "flag": x["wd"] == r["wd"]} for x in rows]},
        ))
    headline = f"{WEEKDAYS[best['wd']]}s leave the most (about {money(best['left'])} each after food, drink and wages); {WEEKDAYS[worst['wd']]}s the least ({money(worst['left'])})"
    action = opps[0]["action"] if opps else "Every day you open pays for itself before rent."
    how = [
        f"Every open day in the last 12 months with timecards ({len(days)} days; event days and holidays left out), grouped by weekday: average sales, minus a {cost_note(measured, share)}, minus wages.",
        "Rent, insurance and other fixed costs aren't taken off — they're paid whether you open or not — so a day that's negative here really costs money to open.",
        "Winter (November to March) and the rest of the year are also checked on their own, so a day that only struggles in winter shows up.",
    ]
    conf = confidence(len(days), 0.05 if not measured else 0.0)
    return insight(
        "week",
        "Your week",
        headline=headline,
        action=action,
        monthly=sum(o["monthly"] for o in opps) or None,
        confidence=conf,
        how=how,
        inputs=[inp(WEEKDAYS[r["wd"]], f"{money(r['sales'])} sales, {money(r['labor'])} wages → {money(r['left'])} left") for r in rows],
        chart={"type": "week", "rows": [{"label": WEEKDAY_SHORT[r["wd"]], "value": round(r["left"]), "sales": round(r["sales"]), "labor": round(r["labor"]), "cogs": round(r["cogs"]), "flag": any(o["subject"] == str(r["wd"]) for o in opps)} for r in rows]},
        details={"rows": rows, "costMeasured": measured, "costShare": share},
        opportunities=opps,
    )
