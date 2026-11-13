"""The insight feed: finders that hunt for surprising, decision-changing facts.

Every finder is a pure function `(data, ctx) -> list[opportunity]`. A finding
must have one number, one action, a confidence and the inputs behind it, and
must be conservative: ranges, shrunk estimates, cautious assumptions. Finders
that don't have enough data return nothing (never a guess).

`oneOff` on a finding is a one-time amount (cash freed, a single bad day); the
feed ranks it at a twelfth per month.
"""

from __future__ import annotations

import math
from collections import defaultdict
from statistics import median

import numpy as np
import pandas as pd
import statsmodels.api as sm

from .common import in_service, open_windows, DAYS_PER_MONTH, WEEKDAYS, WEEKS_PER_MONTH, add_days, cost_note, cost_share, d, daypart, exact_money, hour_label, hours_span, inp, money, open_days, open_days_per_month, opportunity, pct, plural, slot_key, story, weekday
from .staffing import recent_hourly

FOOD_INFLATION = 0.03  # US food-away-from-home CPI has run ~3–4%/yr; we use the low end.


def nice_date(iso_date: str) -> str:
    x = d(iso_date)
    return f"{x.strftime('%b')} {x.day}" + (f", {x.year}" if (d(iso_date).year != __import__('datetime').date.today().year) else "")


def _f(o: dict, one_off: float | None = None) -> dict:
    if one_off is not None:
        o["oneOff"] = float(round(one_off, 2))
    return o


def _cogs_pct(data: dict) -> float:
    return cost_share(data)[0]


# ---- 1. Is each hour worth being open? -------------------------------------------

def open_hours(data: dict, ctx: dict) -> list[dict]:
    """Edge hours (first/last selling hour of a weekday) whose wages cost more than the margin they bring."""
    hourly = recent_hourly(data)
    if not hourly:
        return []
    cogs, measured = cost_share(data)
    windows = open_windows(data, hourly)
    by: dict[tuple[int, int], list[tuple[float, float, float]]] = defaultdict(list)
    dates_by_wd: dict[int, set] = defaultdict(set)
    for r in hourly:
        wd_r, h_r = weekday(r["date"]), int(r["hour"])
        dates_by_wd[wd_r].add(r["date"])
        # Setup before opening and cleanup after close are expected labor, never "an hour that loses money".
        if windows and not in_service(windows, wd_r, h_r):
            continue
        if (r.get("sales") or 0) > 0 or (r.get("laborCost") or 0) > 0:
            by[(wd_r, h_r)].append((float(r.get("sales") or 0), float(r.get("laborCost") or 0), float(r.get("orders") or 0)))
    out = []
    shift_share = 0.3  # cautious: 30% of that hour's guests would come in the next hour instead
    for wd in range(7):
        weeks = len(dates_by_wd[wd])
        # A selling hour: it has sales in at least half the weeks (one early regular doesn't make 9am an opening hour).
        hours = sorted({h for (w, h), v in by.items() if w == wd and sum(1 for s, _, _ in v if s > 0) >= max(3, weeks * 0.5)})
        if len(hours) < 3 or weeks < 3:
            continue
        day_typical = float(np.median([sum(s for s, _, _ in by[(wd, x)]) / weeks for x in hours]))
        for h, edge in ((hours[0], "open"), (hours[-1], "close")):
            v = by[(wd, h)]
            sales = sum(s for s, _, _ in v) / weeks
            if sales >= 0.35 * day_typical:
                continue  # a real selling hour — not worth trimming the day for
            labor = sum(c for _, c, _ in v) / weeks
            guests = sum(o for _, _, o in v) / weeks
            margin = sales * (1 - cogs)
            saving = labor - margin * (1 - shift_share)
            losing_weeks = sum(1 for s, c, _ in v if c > s * (1 - cogs))
            if saving > 15 and losing_weeks / max(1, len(v)) >= 0.6:
                when = f"{WEEKDAYS[wd]}s {hour_label(h)}–{hour_label(h + 1)}"
                act = f"Open at {hour_label(h + 1)} on {WEEKDAYS[wd]}s" if edge == "open" else f"Close at {hour_label(h)} on {WEEKDAYS[wd]}s (last call a little earlier)"
                monthly = saving * WEEKS_PER_MONTH
                grp = slot_key(wd, h)
                part = daypart(h)
                out.append(opportunity(
                    f"feed.hours.{wd}.{h}", "feed.hours", "feed",
                    f"The {hour_label(h)} hour on {WEEKDAYS[wd]}s costs more than it brings in" if edge == "open" else f"The last hour on {WEEKDAYS[wd]}s costs more than it brings in",
                    act + ", or run that hour with one fewer person.",
                    monthly, monthly * 0.5, (labor - margin * 0.9) * WEEKS_PER_MONTH, min(0.7, 0.3 + 0.02 * weeks),
                    [f"Over the last {weeks} {WEEKDAYS[wd]}s, {when} averaged {money(sales)} in sales ({money(margin)} after a {cost_note(measured, cogs)}) and {money(labor)} in wages. It lost money in {losing_weeks} of {len(v)} weeks.", "We assume 30% of those guests would simply come an hour later, so the saving is cautious."],
                    [inp("Sales in the hour (avg)", money(sales)), inp("Guests (orders) in the hour", f"{guests:.0f}"), inp("Wages in the hour (avg)", money(labor)), inp("Food & drink cost", pct(cogs) + ("" if measured else " (typical)")), inp("Weeks", weeks)],
                    href="/schedule", subject=f"{wd}.{h}",
                    area="hours", effort="easy", vector="save", group=grp,
                    story=story(
                        f"On {WEEKDAYS[wd]}s, {when} brings in about {money(sales)} ({guests:.0f} {'order' if round(guests) == 1 else 'orders'}) and costs {money(labor)} in wages.",
                        f"After food and drink costs that hour keeps about {money(margin)}, so it lost money in {losing_weeks} of the last {len(v)} {WEEKDAYS[wd]}s. We assume a third of those guests would just come later.",
                        act + " — or keep the hours and run it with one fewer person.",
                        f"About {money(monthly)} a month.",
                    ),
                    visual={"type": "compare", "unit": "money", "rows": [{"label": "Sales", "value": round(sales)}, {"label": "Kept after food & drink", "value": round(margin)}, {"label": "Wages", "value": round(labor), "tone": "bad"}]},
                ))
    return out


# ---- 2. Event ROI ------------------------------------------------------------------

KIND_LABEL = {"GAME": "Game nights", "MUSIC": "Music nights", "FESTIVAL": "Festivals", "PRIVATE": "Private events", "HOLIDAY": "Holiday eves", "OTHER": "Other events"}


def event_label(kind: str, titles: list[str]) -> str:
    t = " ".join(titles).lower()
    if kind == "GAME" and "knicks" in t:
        return "Knicks nights"
    if kind == "MUSIC" and "live music" in t:
        return "Live music nights"
    return KIND_LABEL.get(kind, "Events")


def event_roi(data: dict, ctx: dict) -> list[dict]:
    days = [x for x in data.get("days", []) if x.get("open") and (x.get("sales") or 0) > 0]
    cogs = _cogs_pct(data)
    normal = [x for x in days if not x.get("eventKinds")]
    groups: dict[str, list[dict]] = defaultdict(list)
    for x in days:
        for k in set(x.get("eventKinds") or []):
            if k == "CLOSURE":
                continue
            base = [y for y in normal if weekday(y["date"]) == weekday(x["date"]) and abs((d(y["date"]) - d(x["date"])).days) <= 42]
            if len(base) < 2:
                continue
            bs = median(y["sales"] for y in base)
            bl = median(float(y.get("labor") or 0) for y in base)
            extra_sales = x["sales"] - bs
            extra_labor = float(x.get("labor") or 0) - bl
            groups[k].append({"date": x["date"], "titles": x.get("eventTitles") or [], "lift": x["sales"] / bs - 1, "extraSales": extra_sales, "extraLabor": extra_labor, "profit": extra_sales * (1 - cogs) - extra_labor, "planned": float(x.get("eventMult") or 1) - 1})
    upcoming = defaultdict(int)
    horizon = add_days(data["asOf"], 30)
    for x in data.get("future", []) + data.get("futureEvents", []):
        if x["date"] <= horizon:
            for k in set(x.get("eventKinds") or []):
                upcoming[k] += 1
    out = []
    for k, ev in groups.items():
        n = len(ev)
        avg = float(np.mean([e["profit"] for e in ev]))
        sd = float(np.std([e["profit"] for e in ev], ddof=1)) if n > 1 else abs(avg) * 0.6 + 50
        # Shrink toward zero with few events: n / (n + 1).
        shrunk = avg * n / (n + 1)
        lift = float(np.mean([e["lift"] for e in ev]))
        planned = float(np.mean([e["planned"] for e in ev]))
        label = event_label(k, [t for e in ev for t in e["titles"]])
        per_month = max(1, upcoming.get(k, 0)) if upcoming.get(k) else n / max(1, len(days) / DAYS_PER_MONTH)
        how = [f"Each {label.lower()[:-1]} compared with the median same weekday without an event within 6 weeks: extra sales × (1 − food cost {pct(cogs)}) − extra labor.", f"{n} so far: " + "; ".join(f"{e['date']} {money(e['profit'])}" for e in ev) + f". Averaged and shrunk toward zero because {n} is a small sample."]
        inputs = [inp("Events", n), inp("Average sales lift", pct(lift)), inp("Planned lift in Events", pct(planned)), inp("Average extra profit", money(avg)), inp("Upcoming in 30 days", upcoming.get(k, 0))]
        if abs(lift - planned) >= 0.12 and n >= 2:
            # The forecast, schedule and orders all use the planned impact.
            title = f"{label} really do {'+' if lift >= 0 else ''}{round(lift * 100)}%, not the {'+' if planned >= 0 else ''}{round(planned * 100)}% you planned"
            gap_sales = abs(lift - planned) * float(np.mean([e["extraSales"] / max(0.01, e["lift"]) for e in ev if e["lift"]]))
            out.append(opportunity(f"feed.event.impact.{k}", "feed.event.impact", "feed", title, f"Change the impact on upcoming {label.lower()} to {1 + lift:.2f}× on the Events page so staffing and orders match.", gap_sales * (1 - cogs) * 0.1 * per_month + 20, None, None, min(0.6, 0.25 + 0.1 * n), how, inputs, href="/events", subject=k))
        title = f"{label} add ≈ {money(shrunk)} profit each" + (f" — {upcoming[k]} coming up" if upcoming.get(k) else "")
        booked = k in ("MUSIC", "PRIVATE", "OTHER")  # things you choose to put on
        if shrunk < 100 and booked:
            act = f"{label} barely pay for themselves before any band or promo cost — reconsider the fee or pick busier nights."
        elif shrunk <= 0:
            act = f"{label} lose money after extra labor — staff them like a normal night{' or drop them' if booked else ''}."
        elif booked:
            act = f"Book more {label.lower()}: each is worth about {money(shrunk)} after extra labor (before any fees)."
        else:
            act = f"Plan for them: each is worth about {money(shrunk)} after extra labor — make sure the schedule and orders carry the bump."
        monthly = abs(shrunk) * per_month if (shrunk < 100 and k in ("MUSIC", "OTHER")) or shrunk < 0 else shrunk * 0.25 * per_month
        out.append(opportunity(f"feed.event.roi.{k}", "feed.event.roi", "feed", title, act, monthly, monthly * 0.5, monthly * 1.5, min(0.6, 0.2 + 0.1 * n), how, inputs, href="/events", subject=k))
    return out


# ---- 3. Supplier price creep (and typos) -------------------------------------------

def price_creep(data: dict, ctx: dict) -> list[dict]:
    hist = data.get("priceHistory", [])
    as_of = data["asOf"]
    out = []
    by_sup: dict[str, list[dict]] = defaultdict(list)
    for p in hist:
        pts = sorted(p.get("points") or [])
        if len(pts) < 2:
            continue
        last_date, last = pts[-1]
        prev = [x for x in pts[:-1] if x[1] > 0]
        if prev and last > 0:
            ref = prev[-1][1]
            if last / ref >= 3 or last / ref <= 0.33:
                misstated = (p.get("monthlySpend") or 0) * (1 - ref / last) if last > ref else 0
                out.append(_f(opportunity(f"feed.price.typo.{p['productId']}.{last_date}", "feed.price.typo", "feed", f"{p['ingredient'] or p['product']} is now ${last:.2f} (was ${ref:.2f}) — looks like a typo", f"Check the {p['supplier']} price on {last_date} on the Prices page; it's throwing off plate costs.", min(250.0, max(25.0, misstated)), None, None, 0.8,
                                              [f"A {last / ref:.1f}× jump in one step is almost never real. Until it's fixed, every recipe using it shows the wrong cost (menu engineering leaves it out).", f"It isn't money lost — it's wrong numbers: about {money(misstated)} a month of cost of goods would be overstated. Ranked as if it were worth up to $250/month because it skews everything else."], [inp("Previous price", f"${ref:.2f}"), inp("New price", f"${last:.2f}"), inp("Date", last_date)], href="/prices", subject=p["productId"])))
                pts = pts[:-1]
        year_ago = add_days(as_of, -365)
        window = [x for x in pts if x[0] >= year_ago] or pts
        first_date, first = next(((dt, pr) for dt, pr in pts if dt <= window[0][0]), pts[0])
        last_date, last = pts[-1]
        span = max((d(as_of) - d(first_date)).days, 1)
        if span < 45 or first <= 0:
            continue
        annual = (last / first) ** (365 / span) - 1
        by_sup[p["supplier"]].append({**p, "annual": annual, "rise": last / first - 1, "from": first, "to": last, "since": first_date, "spend": float(p.get("monthlySpend") or 0)})
    for sup, rows in by_sup.items():
        spend = sum(r["spend"] for r in rows)
        if spend <= 0:
            continue
        rise = sum(r["rise"] * r["spend"] for r in rows) / spend
        span_days = sum((d(as_of) - d(r["since"])).days * r["spend"] for r in rows) / spend
        expected = (1 + FOOD_INFLATION) ** (span_days / 365) - 1
        excess = rise - expected
        since = min(r["since"] for r in rows)
        if excess < 0.04 or spend * 12 < 500:
            continue
        drivers = sorted(rows, key=lambda r: -(r["rise"] * r["spend"]))[:3]
        saving_year = spend * 12 * excess / (1 + rise) * 0.5  # cautious: win back half the excess
        months = max(1, round(span_days / 30.4))
        out.append(opportunity(f"feed.price.creep.{sup}", "feed.price.creep", "feed", f"{sup} is up {round(rise * 100)}% in {months} months on what you buy — inflation alone would be {round(expected * 100)}%", f"Get a competing quote for {', '.join(r['ingredient'] or r['product'] for r in drivers[:2])} and ask {sup} to hold prices; winning back half the gap saves ~{money(saving_year)}/yr.", saving_year / 12, saving_year / 24, saving_year / 12 * 1.6, 0.45,
                               [f"Each product's first and latest price in the history (from {since}), weighted by what you spend on it each month ({money(spend)}/month at {sup}).", "Biggest drivers: " + "; ".join(f"{r['ingredient'] or r['product']} ${r['from']:.2f} → ${r['to']:.2f} since {r['since']}" for r in drivers) + ".", f"General food inflation runs about {round(FOOD_INFLATION * 100)}% a year, so about {round(expected * 100, 1)}% over this stretch. The saving assumes you win back half of the gap."],
                               [inp("Monthly spend", money(spend)), inp("Rise", pct(rise)), inp("Inflation over the same time", pct(expected, 1)), inp("Gap", pct(excess))], href="/prices", subject=sup))
    return out


# ---- 4. Hidden profit leaks --------------------------------------------------------

def leaks(data: dict, ctx: dict) -> list[dict]:
    out = []
    v = data.get("variance")
    if v and v.get("days") and (v.get("unexplainedCost") or 0) > 0:
        per_month = v["unexplainedCost"] / v["days"] * DAYS_PER_MONTH
        top = sorted([r for r in v.get("rows", []) if (r.get("unexplainedCost") or 0) > 0], key=lambda r: -r["unexplainedCost"])[:3]
        if per_month > 50:
            out.append(opportunity("feed.leak.gap", "feed.leak.gap", "feed", f"~{money(per_month)}/month of stock is unaccounted for (≈ {money(per_month * 12)}/yr)", f"Spot-check {', '.join(r['name'] for r in top[:2])}: portioning, unrung items or deliveries short." if top else "Count again and compare.", per_month, per_month * 0.5, per_month, 0.4 if v["days"] < 14 else 0.55,
                                   [f"Between the counts on {v['from']} and {v['to']} ({v['days']} days), you used {money(v['unexplainedCost'])} more than sales and logged waste explain. Scaled to a month. Two counts is one sample, so the low end is half."] + ([("Biggest: " + "; ".join(f"{r['name']} {money(r['unexplainedCost'])}" for r in top) + ".")] if top else []),
                                   [inp("Unexplained", money(v["unexplainedCost"])), inp("Days between counts", v["days"])], href="/variance", subject="gap"))
    waste_days = [x for x in data.get("days", []) if x.get("wasteLogged")]
    if len(waste_days) >= 5:
        per_day = sum(float(x.get("waste") or 0) for x in waste_days) / len(waste_days)
        per_month = per_day * open_days_per_month(data.get("days", []))
        top = data.get("wasteTop") or []
        if per_month > 60:
            out.append(opportunity("feed.leak.waste", "feed.leak.waste", "feed", f"Logged waste runs ~{money(per_month)}/month (≈ {money(per_month * 12)}/yr)", f"Prep smaller batches of {top[0]['name']} — it's the biggest line." if top else "Prep smaller batches of the top items.", per_month * 0.25, per_month * 0.1, per_month * 0.4, 0.45,
                                   [f"{len(waste_days)} days of waste logs average {money(per_day)} a day at cost, scaled to open days in a month. Cutting a quarter is a realistic first target."] + ([("Top: " + "; ".join(f"{t['name']} {money(t['cost'])}" for t in top[:3]) + ".")] if top else []),
                                   [inp("Days logged", len(waste_days)), inp("Average per day", money(per_day))], href="/waste", subject="waste"))
    inv = data.get("invoices") or {}
    if (inv.get("priceIssueDollars") or 0) > 10:
        out.append(_f(opportunity("feed.leak.invoices", "feed.leak.invoices", "feed", f"{inv['priceIssues']} invoice line(s) billed {money(inv['priceIssueDollars'])} over the agreed price", "Send the credit requests from Invoices before they're paid.", 10.0, None, None, 0.85, ["Invoice lines whose price is above the order or price-sheet price, still open."], [inp("Lines", inv["priceIssues"]), inp("Over-billed", money(inv["priceIssueDollars"]))], href="/invoices", subject="invoices"), inv["priceIssueDollars"]))
    return out


# ---- 5. Draft beer pour yield -------------------------------------------------------

def pour_yield(data: dict, ctx: dict) -> list[dict]:
    out = []
    for b in data.get("beer") or []:
        theo, actual = float(b.get("theoretical") or 0), float(b.get("actual") or 0)
        if theo <= 0 or actual <= 0 or not b.get("days"):
            continue
        over = actual / theo - 1
        # Foam and line loss of ~5% is normal; only the rest is money.
        excess = over - 0.05
        if excess < 0.03:
            continue
        per_month = excess * theo * float(b.get("costPerBase") or 0) / b["days"] * DAYS_PER_MONTH
        sales_value = excess * theo * float(b.get("pricePerBase") or 0) / b["days"] * DAYS_PER_MONTH
        out.append(opportunity(f"feed.pour.{b['id']}", "feed.pour", "feed", f"{b['name']}: kegs are emptying {round(over * 100)}% faster than pints sold — ≈ {money(per_month)}/month in beer (≈ {money(sales_value)} at menu price)", "Check pour sizes and the tap line for foam; a marked 16 oz glass or a jigger test on a busy night usually finds it.", per_month, per_month * 0.5, max(per_month, sales_value * 0.5), 0.45 if b["days"] < 14 else 0.6,
                               [f"Between counts ({b['days']} days) the keg level dropped by {actual / 1000:.1f} L but pints sold account for {theo / 1000:.1f} L. 5% is normal foam and line loss; the rest is over-pouring, comps or unrung pints."], [inp("Used (counts)", f"{actual / 1000:.1f} L"), inp("Sold (Square)", f"{theo / 1000:.1f} L"), inp("Normal loss allowed", "5%")], href="/variance", subject=b["id"]))
    return out


# ---- 6. Menu mix shifts --------------------------------------------------------------

def mix_shift(data: dict, ctx: dict) -> list[dict]:
    menu = (ctx.get("menu") or {}).get("details", {}).get("rows", [])
    cm = {r["id"]: r["cm"] for r in menu}
    items = [i for i in data.get("items", []) if i.get("kind") == "MENU" and i["id"] in cm and (i.get("group") or "food") == "food"]
    if len(items) < 3:
        return []
    weeks = defaultdict(lambda: defaultdict(float))
    for it in items:
        for dt, (q, _) in (it.get("daily") or {}).items():
            wk = d(dt).isocalendar()
            weeks[(wk[0], wk[1])][it["id"]] += q
    keys = sorted(weeks)[-9:-1] if len(weeks) > 8 else sorted(weeks)[:-1]  # full weeks only
    if len(keys) < 6:
        return []
    shares = pd.DataFrame([{iid: weeks[k][iid] / max(1e-9, sum(weeks[k].values())) for iid in cm if iid in {i["id"] for i in items}} for k in keys]).fillna(0)
    t = np.arange(len(keys), dtype=float)
    trends = {}
    for iid in shares.columns:
        m = sm.OLS(shares[iid].values, sm.add_constant(t)).fit()
        trends[iid] = (float(m.params[1]), float(m.pvalues[1]))
    total_month = sum(sum(q for q, _ in (i.get("daily") or {}).values()) for i in items) / max(1, len(open_days(data.get("days", [])))) * open_days_per_month(data.get("days", []))
    names = {i["id"]: i["name"] for i in items}
    out = []
    risers = [(iid, s, p) for iid, (s, p) in trends.items() if s > 0 and p < 0.15]
    fallers = [(iid, s, p) for iid, (s, p) in trends.items() if s < 0 and p < 0.15]
    cat = {i["id"]: (i.get("category") or "").lower() for i in items}
    for iid, s, p in risers:
        rivals = [f for f in fallers if cat.get(f[0]) == cat.get(iid)]  # a main swaps with a main, not a side
        if not rivals:
            continue
        loser = min(rivals, key=lambda x: x[1])
        swap = cm[iid] - cm[loser[0]]
        per_month = s * 4.33 * total_month * swap  # share gained per month × volume × margin difference
        if abs(per_month) < 15:
            continue
        good = swap > 0
        title = f"{names[iid]} is taking share from the {names[loser[0]]} — each swap {'earns' if good else 'costs'} you ${abs(swap):.2f}"
        act = f"Nothing to fix — keep featuring the {names[iid]}." if good else f"Nudge guests back to the {names[loser[0]]} (menu position, server mention) or raise the {names[iid]} ${abs(swap):.2f}."
        out.append(opportunity(f"feed.mix.{iid}.{loser[0]}", "feed.mix", "feed", title, act, abs(per_month) if not good else abs(per_month) * 0.2, abs(per_month) * 0.4, abs(per_month), 0.35 + (0.15 if p < 0.05 else 0),
                               [f"Over the last {len(keys)} full weeks the {names[iid]}'s share of food items sold rose {s * 100:.1f} points a week (p = {p:.2f}) while the {names[loser[0]]}'s fell {abs(loser[1]) * 100:.1f} points a week.", f"Margins: {names[iid]} ${cm[iid]:.2f}, {names[loser[0]]} ${cm[loser[0]]:.2f}. Monthly effect = share moving per month × about {total_month:.0f} food items a month × the margin difference."],
                               [inp("Weeks", len(keys)), inp(f"{names[iid]} trend", f"{s * 100:+.1f} pts/week"), inp(f"{names[loser[0]]} trend", f"{loser[1] * 100:+.1f} pts/week"), inp("Margin difference", f"${swap:.2f}")], href="/insights#menu", subject=iid))
    return out


# ---- 7. Labor this week ----------------------------------------------------------------

def labor_week(data: dict, ctx: dict) -> list[dict]:
    s = data.get("schedule") or {}
    out = []
    for p in s.get("people") or []:
        ot = float(p.get("hours") or 0) - 40
        if ot > 0.5 and p.get("rate"):
            cost = ot * float(p["rate"]) * 0.5 * (1 + float(data.get("burdenPct") or 0))
            out.append(_f(opportunity(f"feed.overtime.{s.get('weekStart')}.{p['name']}", "feed.overtime", "feed", f"{p['name']} is down for {p['hours']:.0f} hours this week — {ot:.1f}h of overtime ≈ {money(cost)} extra", f"Move one of {p['name']}'s shifts to someone under 32 hours.", cost * WEEKS_PER_MONTH * 0.25, None, None, 0.85, [f"Worked + scheduled hours for the week starting {s.get('weekStart')}. Overtime costs half again on top of the ${float(p['rate']):.2f} rate."], [inp("Hours", f"{p['hours']:.1f}"), inp("Rate", f"${float(p['rate']):.2f}")], href="/schedule", subject=p["name"]), cost))
    fs, cost, target = s.get("forecastSales"), s.get("cost"), s.get("laborTarget")
    if fs and cost and target and fs > 0:
        share = cost / fs
        if share > target + 0.03:
            extra = cost - target * fs
            hours = extra / max(1.0, float(s.get("avgRate") or 18))
            out.append(_f(opportunity(f"feed.schedule.{s.get('weekStart')}", "feed.schedule", "feed", f"Next week's schedule is {pct(share)} of forecast sales vs your {pct(target)} target — about {hours:.0f} hours too many", f"Trim ~{hours:.0f} hours, starting with the over-staffed hours on the Insights page.", extra * 0.5, None, None, 0.6, [f"Scheduled labor {money(cost)} against forecast sales {money(fs)} for the week starting {s.get('weekStart')}."], [inp("Scheduled labor", money(cost)), inp("Forecast sales", money(fs)), inp("Labor target", pct(target))], href="/schedule", subject=s.get("weekStart"))))
    return out


# ---- 9. Cash tied up in stock -----------------------------------------------------------

TYPICAL_DAYS = {"produce": 4, "dairy": 7, "protein": 5, "bakery": 3, "frozen": 14, "pantry": 14, "beer": 14, "other": 14}


def inventory_cash(data: dict, ctx: dict) -> list[dict]:
    rows = data.get("inventory") or []
    by = defaultdict(lambda: {"value": 0.0, "use": 0.0, "items": []})
    for r in rows:
        cat = next((k for k in TYPICAL_DAYS if k in (r.get("category") or "").lower()), "other")
        if (r.get("onHandValue") or 0) <= 0:
            continue
        by[cat]["value"] += r["onHandValue"]
        by[cat]["use"] += float(r.get("dailyUsageValue") or 0)
        by[cat]["items"].append(r)
    out = []
    for cat, v in by.items():
        if v["use"] <= 0:
            continue
        days_on_hand = v["value"] / v["use"]
        typical = TYPICAL_DAYS[cat]
        if days_on_hand > typical * 1.6:
            freed = v["value"] - typical * v["use"]
            if freed < 150:
                continue
            slow = sorted(v["items"], key=lambda r: -(r["onHandValue"] / max(0.01, r.get("dailyUsageValue") or 0.01)))[:2]
            out.append(_f(opportunity(f"feed.cash.{cat}", "feed.cash", "feed", f"You're carrying {days_on_hand:.0f} days of {cat} — {typical} is typical; ordering leaner frees ~{money(freed)}", f"Skip or shrink the next {cat} order for {', '.join(s['name'] for s in slow)}.", freed * 0.02, None, None, 0.45, [f"Estimated stock on hand (last count + deliveries − sales usage − waste) is worth {money(v['value'])} at cost; you use about {money(v['use'])} a day. Typical for {cat} is about {typical} days.", "The ranking counts freed cash at 2% a month (carrying cost and spoilage risk)."], [inp("On hand at cost", money(v["value"])), inp("Use per day", money(v["use"])), inp("Days on hand", f"{days_on_hand:.0f}")], href="/ordering", subject=cat), freed))
    return out


# ---- 10. Weather sensitivity --------------------------------------------------------------

def weather(data: dict, ctx: dict) -> list[dict]:
    rows = [x for x in open_days(data.get("days", [])) if not x.get("eventKinds") and x.get("hasWeather")]
    if len(rows) < 28:
        return []
    wet = sum(1 for x in rows if x.get("wet"))
    if wet < 5:
        return []
    df = pd.DataFrame([{"y": math.log(x["sales"]), "wd": weekday(x["date"]), "wet": 1.0 if x.get("wet") else 0.0} for x in rows])
    X = pd.get_dummies(df["wd"], prefix="wd", drop_first=True).astype(float)
    X["wet"] = df["wet"]
    m = sm.OLS(df["y"], sm.add_constant(X)).fit(cov_type="HC1")
    b, se = float(m.params["wet"]), float(m.bse["wet"])
    lo, hi = b - 1.28 * se, b + 1.28 * se
    if hi >= 0 and lo <= 0:
        return []
    effect, elo, ehi = math.exp(b) - 1, math.exp(lo) - 1, math.exp(hi) - 1
    avg = float(np.mean([x["sales"] for x in rows]))
    per_day = effect * avg
    splh = ctx.get("splh") or 0
    wage = ctx.get("wage") or 18
    upcoming = [x["date"] for x in data.get("future", [])[:7] if x.get("wet")]
    if effect < 0 and splh:
        hours = abs(per_day) / splh
        saving_day = hours * wage
        wet_month = wet / len(rows) * open_days_per_month(data.get("days", []))
        title = f"Rainy days run {round(abs(effect) * 100)}% below normal ({round(abs(ehi) * 100)}–{round(abs(elo) * 100)}%) — about {money(abs(per_day))} less"
        act = f"When rain is forecast, cut ~{hours:.0f} labor hours (call off one {'server' if hours < 7 else 'server and a cook'})" + (f" — rain is forecast {', '.join(WEEKDAYS[weekday(x)] for x in upcoming)}." if upcoming else ".")
        return [opportunity("feed.weather.rain", "feed.weather", "feed", title, act, saving_day * wet_month, saving_day * wet_month * 0.5, saving_day * wet_month * 1.3, 0.5, [f"A regression of log daily sales on weekday and a wet-day flag over {len(rows)} normal open days ({wet} wet). Event days are left out.", f"At your usual {money(splh)} of sales per labor hour, {money(abs(per_day))} less in sales needs about {hours:.1f} fewer hours ({money(saving_day)} at {money(wage, True)}/h). About {wet_month:.1f} wet open days a month."], [inp("Days", len(rows)), inp("Wet days", wet), inp("Effect", f"{effect * 100:+.0f}%"), inp("80% range", f"{elo * 100:+.0f}% to {ehi * 100:+.0f}%")], href="/schedule", subject="rain")]
    return []


# ---- 11. Reviews ↔ staffing ----------------------------------------------------------------

SERVICE_WORDS = ("wait", "slow", "service")


def reviews_ops(data: dict, ctx: dict) -> list[dict]:
    revs = [r for r in data.get("reviews") or [] if any(w in " ".join(r.get("themes") or []).lower() for w in SERVICE_WORDS) and (r.get("rating") or 5) <= 3]
    if len(revs) < 2:
        return []
    days = {x["date"]: x for x in open_days(data.get("days", [])) if x.get("laborHours")}
    usual = {}
    for wd in range(7):
        v = [x["sales"] / x["laborHours"] for x in days.values() if weekday(x["date"]) == wd]
        if v:
            usual[wd] = median(v)
    lean = []
    for r in revs:
        x = days.get(r["date"]) or days.get(add_days(r["date"], -1))
        if not x or weekday(x["date"]) not in usual:
            continue
        ratio = (x["sales"] / x["laborHours"]) / usual[weekday(x["date"])]
        lean.append((r, x, ratio))
    hits = [h for h in lean if h[2] >= 1.12]
    if len(hits) < 2 or len(hits) / max(1, len(lean)) < 0.5:
        return []
    avg = float(np.mean([h[2] for h in hits])) - 1
    return [opportunity("feed.reviews.lean", "feed.reviews", "feed", f"{len(hits)} of {len(lean)} slow-service reviews came on days you ran {round(avg * 100)}% leaner than usual", "On the busiest nights, add one server for the peak 3 hours rather than stretching the floor.", 40.0, 20.0, 80.0, 0.35, ["Low reviews mentioning waits or service, matched to that day's (or the night before's) sales per labor hour against the same weekday's median."] + [f"{h[1]['date']}: {h[0].get('rating')}★, {round((h[2] - 1) * 100)}% leaner" for h in hits[:4]], [inp("Service complaints", len(lean)), inp("On lean days", len(hits))], href="/reviews", subject="service")]


# ---- 12. Follow-through ------------------------------------------------------------------

def follow_through(data: dict, ctx: dict) -> list[dict]:
    """Before/after on price changes (detected or marked done), traffic-adjusted."""
    as_of = data["asOf"]
    traffic = {x["date"]: float(x.get("orders") or 0) for x in data.get("days", []) if x.get("orders")}
    price_items = {x["id"]: x for x in (ctx.get("price") or {}).get("details", {}).get("items", [])}
    tracked = []
    for iid, f in price_items.items():
        for c in f.get("changes") or []:
            tracked.append((iid, c["date"], f"{'raising' if c['to'] > c['from'] else 'cutting'} the {f['name']} ${abs(c['to'] - c['from']):.2f}"))
    for a in data.get("actions") or []:
        if a.get("kind") in ("menu.reprice", "price.test") and a.get("subject") and a.get("doneAt"):
            tracked.append((a["subject"], a["doneAt"][:10], f"acting on “{a.get('title', 'the price change')}”"))
    items = {i["id"]: i for i in data.get("items", [])}
    out = []
    seen = set()
    opm = open_days_per_month(data.get("days", []))
    # Only changes the daily history can judge (it covers the last ~4 months), latest per item.
    first_daily = min((k for i in items.values() for k in (i.get("daily") or {})), default=as_of)
    latest: dict[str, tuple[str, str, str]] = {}
    for iid, start, what in tracked:
        if start < add_days(first_daily, 28) or start > as_of:
            continue
        if iid not in latest or start > latest[iid][1]:
            latest[iid] = (iid, start, what)
    for iid, start, what in latest.values():
        if (iid, start) in seen or iid not in items:
            continue
        seen.add((iid, start))
        if sum(v[0] for k, v in (items[iid].get("daily") or {}).items() if k >= add_days(start, -28)) < 30:
            continue  # too few sold to tell anything
        it = items[iid]
        daily = it.get("daily") or {}
        before = [(k, v) for k, v in daily.items() if add_days(start, -28) <= k < start]
        after = [(k, v) for k, v in daily.items() if start <= k < as_of]
        if len(after) < 12 or len(before) < 12:
            if len(after) < 12 and 0 <= (d(as_of) - d(start)).days <= 21:
                out.append(opportunity(f"feed.follow.wait.{iid}.{start}", "feed.follow.wait", "feed", f"Tracking {what} — results in {plural(max(1, 14 - len(after)), 'more open day')}", "Nothing to do; we'll report the before and after.", 5.0, 0, 10, 0.2, ["We need two weeks after a change to compare fairly."], href="/insights", subject=iid, area="menu", effort="easy", vector="info"))
            continue
        cost = float(it["unitCost"]) if it.get("unitCost") is not None else float(it.get("price") or 0) * cost_share(data)[0]
        tb = np.mean([traffic.get(k, np.nan) for k, _ in before])
        ta = np.mean([traffic.get(k, np.nan) for k, _ in after])
        adj = tb / ta if tb and ta and np.isfinite(tb) and np.isfinite(ta) else 1.0
        def per_day(rows):
            q = sum(v[0] for _, v in rows)
            s = sum(v[1] for _, v in rows)
            return q / len(rows), (s - q * cost) / len(rows)
        qb, pb = per_day(before)
        qa, pa = per_day(after)
        qa_adj, pa_adj = qa * adj, pa * adj
        gain = (pa_adj - pb) * opm
        vol = qa_adj / qb - 1 if qb else 0
        when = nice_date(start)
        title = f"Since {what} on {when}: {'+' if gain >= 0 else '−'}{money(abs(gain))} a month, {'the same number sold' if abs(vol) < 0.05 else f'{abs(vol) * 100:.0f}% {"more" if vol > 0 else "fewer"} sold'}"
        out.append(opportunity(f"feed.follow.{iid}.{start}", "feed.follow", "feed", title, "Keep it." if gain >= 0 else "Consider rolling it back.", abs(gain), abs(gain) * 0.5, abs(gain) * 1.3, 0.5, [f"28 days before vs {len(after)} open days after, per open day, with the 'after' scaled by store traffic (order count) so a busier month doesn't get the credit."], [inp("Profit/day before", money(pb, True)), inp("Profit/day after (traffic-adjusted)", money(pa_adj, True)), inp("Volume change", f"{vol * 100:+.0f}%")], href="/insights#lab-price", subject=iid,
                               area="menu", effort="easy", vector="info" if gain > -60 else "earn", story=story(f"On {when} you started {what}.", f"Per open day, the 28 days before vs the {len(after)} days after — with the after scaled to store traffic so a busier month doesn't get the credit — profit on it is {'up' if gain >= 0 else 'down'} {money(abs(gain))} a month and {'the same number sold' if abs(vol) < 0.05 else f'{abs(vol) * 100:.0f}% {"more" if vol > 0 else "fewer"} sold'}.", "Keep it." if gain >= 0 else "Consider putting the price back.", f"{'+' if gain >= 0 else '−'}{money(abs(gain))} a month so far."), visual={"type": "compare", "unit": "money", "rows": [{"label": "Profit a day before", "value": round(pb, 2)}, {"label": "After", "value": round(pa_adj, 2), "tone": "good" if gain >= 0 else "bad"}]}))
    return out


FINDERS = [open_hours, event_roi, price_creep, leaks, pour_yield, mix_shift, labor_week, inventory_cash, weather, reviews_ops, follow_through]


def merge_slots(items: list[dict], ctx: dict) -> list[dict]:
    """One root cause, one action: when an hour that loses money and an over-staffed stretch are the
    same part of the same day, write a single lead that tells both halves (the app shows only the lead)."""
    staff = [o for o in (ctx.get("staffing") or {}).get("opportunities", []) if o.get("group")]
    out = []
    for h in [o for o in items if o.get("kind") == "feed.hours" and o.get("group")]:
        s = next((o for o in staff if o["group"] == h["group"]), None)
        if not s:
            continue
        monthly = max(h["monthly"], s["monthly"])
        hs, ss = h.get("story") or {}, s.get("story") or {}
        out.append(opportunity(
            f"lab.{h['group']}", "lab.slot", "feed",
            s["title"].replace("has more people on than it needs", "is quiet but fully staffed"),
            s["action"],
            monthly, min(h["low"], s["low"]), max(h["high"], s["high"]), max(h["confidence"], s["confidence"]),
            (s.get("how") or []) + (h.get("how") or []), (s.get("inputs") or []) + (h.get("inputs") or []),
            href="/schedule", subject=h["group"], area="staffing", effort="easy", vector="save", group=h["group"], lead=True,
            story={"now": (hs.get("now", "") + " " + ss.get("now", "")).strip(), "why": ss.get("why", ""), "todo": ss.get("todo", "") + " If that hour stays this quiet: " + hs.get("todo", ""), "gain": f"About {money(monthly)} a month — we count the bigger of the two fixes, not both."},
            visual=s.get("visual"),
        ))
    return out


def run(data: dict, ctx: dict) -> dict:
    items, errors = [], []
    for f in FINDERS:
        try:
            items.extend(f(data, ctx))
        except Exception as e:  # one finder failing never blocks the feed
            errors.append(f"{f.__name__}: {e}")
    try:
        items.extend(merge_slots(items, ctx))
    except Exception as e:  # noqa: BLE001
        errors.append(f"merge_slots: {e}")
    return {"items": items, "errors": errors, "finders": [f.__name__ for f in FINDERS]}
