"""Price follow-ups: what did a price change really do to an item, once everything else is allowed for?

A raw before/after ("30% fewer sold since the price went up") also counts every
other reason sales moved: fewer guests that month, a different weekday mix, the
season turning, Labor Day, a keg that kicked. We measure the item *relative to
the business*:

1. Days: the 6 weeks before the change vs the days since (up to 9 weeks),
   leaving out event days, holidays, short days (under 40% of a normal day)
   and days the item didn't sell at all when it normally would (86'd / keg out).
2. Traffic and weekday mix: units per 100 orders, each weekday weighted the
   same in both periods (so an "after" with more Mondays isn't penalised).
3. Season: the same weeks a year earlier (and two years, when there),
   from weekly sales — how much this item's share usually moves at this time
   of year. When those weeks aren't in the history, the rest of the item's
   category over the same days is the yardstick instead.
4. Effect = the item's change minus the usual change (a difference in
   differences), with a likely range from resampling days and weeks (5–95%).
5. Substitution: did the rest of the category pick up what this item lost?
   (A guest who switches beers isn't a lost sale for the business.)
6. Only an effect whose likely range stays clear of zero, and is at least 5%,
   is reported as a result. Anything else goes on the watch list, with what
   would make it count.
"""

from __future__ import annotations

import math

import numpy as np

from .common import add_days, cost_share, d, exact_money, inp, money, open_days_per_month, opportunity, plural, story, weekday
from .common import shrink
from .context import bootstrap_pooled, bootstrap_rates, bootstrap_weeks, day_context, evidence, nice_date, num_words, pct_words, range_words, row, standardized_rate, sure_line, week_monday

BEFORE_DAYS = 42  # six weeks before (or as many as the daily history has)
MAX_AFTER_DAYS = 63
MIN_DAYS = 10  # fair days on each side
MIN_EFFECT = 0.05  # smaller than ±5% isn't worth acting on even if it's real
UNAVAILABLE_EXPECTED = 4.0  # zero sold on a day we'd expect 4+ → it wasn't available
B = 800
SEASON_TAU = 0.2  # how far one item's seasonal move can stray from its category's
FALLBACK_SD = 0.1  # extra doubt when the season comes from the category (or isn't known)
MAX_STEP = 0.4  # a 40%+ jump is a different product or size, not a price change

TYPICAL_COST = {"beer": 0.22, "drink": 0.24, "main": 0.32, "side": 0.28, "snack": 0.28, "add-on": 0.25, "other": 0.30}


def _unit_cost(item: dict, price: float, data: dict) -> tuple[float, bool]:
    if item.get("unitCost") is not None and not item.get("costIncomplete"):
        return float(item["unitCost"]), False
    from .price import prior_for  # local: price imports nothing from here

    cat = prior_for(item.get("category") or "", item.get("group"))[0]
    share = TYPICAL_COST.get(cat) if item.get("linked") is False else cost_share(data)[0]
    return price * (share or 0.3), True


def _weekly_orders(data: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for x in data.get("days") or []:
        if x.get("open") and (x.get("orders") or 0) > 0:
            k = week_monday(x["date"])
            out[k] = out.get(k, 0.0) + float(x["orders"])
    return out


def _season_baseline(item: dict, start: str, n_before_wk: int, n_after_wk: int, w_orders: dict[str, float], as_of: str, years: tuple[int, ...] = (1, 2)) -> list[dict]:
    """Per prior year (1, 2): the item's units per 100 orders in the same weeks, before vs after.
    Skipped when the item barely sold then, or its own price moved inside those weeks."""
    weekly = item.get("weekly") or {}
    out = []
    s_mon = week_monday(start)
    for k in years:
        shift = 364 * k
        b_weeks = [add_days(s_mon, -shift - 7 * j) for j in range(n_before_wk, 0, -1)]
        a_weeks = [add_days(s_mon, -shift + 7 * j) for j in range(n_after_wk)]
        if not all(w_orders.get(w) for w in b_weeks + a_weeks):
            continue
        sold = [w for w in b_weeks + a_weeks if (weekly.get(w) or [0, 0])[0] > 0]
        if len(sold) < 0.75 * (len(b_weeks) + len(a_weeks)):
            continue
        def price_of(ws):
            q = sum((weekly.get(w) or [0, 0])[0] for w in ws)
            s = sum((weekly.get(w) or [0, 0])[1] for w in ws)
            return s / q if q else float("nan")
        pb, pa = price_of(b_weeks), price_of(a_weeks)
        if not (math.isfinite(pb) and math.isfinite(pa)) or abs(pa / pb - 1) > 0.03:
            continue  # its price moved then too — not a clean yardstick
        ub = [float((weekly.get(w) or [0, 0])[0]) for w in b_weeks]
        ua = [float((weekly.get(w) or [0, 0])[0]) for w in a_weeks]
        ob = [w_orders[w] for w in b_weeks]
        oa = [w_orders[w] for w in a_weeks]
        rb, ra = sum(ub) / sum(ob), sum(ua) / sum(oa)
        if rb <= 0 or ra <= 0:
            continue
        sb = bootstrap_pooled(ub, ob, B, seed=100 + k)
        sa = bootstrap_pooled(ua, oa, B, seed=200 + k)
        out.append({"years": k, "before": rb * 100, "after": ra * 100, "change": math.log(ra / rb), "samples": np.log(np.maximum(sa, 1e-9) / np.maximum(sb, 1e-9)), "weeks": (b_weeks, a_weeks), "series": [(w, (weekly.get(w) or [0, 0])[0] / w_orders[w] * 100) for w in b_weeks + a_weeks]})
    return out


def _rows_for(daily: dict, dates: list[str], days: dict) -> list[tuple[int, float, float]]:
    return [(weekday(k), float((daily.get(k) or [0, 0])[0]), float(days[k].get("orders") or 0)) for k in dates]


def measure(data: dict, item: dict, start: str, p_from: float, p_to: float, siblings: list[dict] | None = None, prev_change: str | None = None) -> dict | None:
    """Traffic-, weekday- and season-adjusted effect of one price change. None if the history can't judge it."""
    ctx = day_context(data)
    as_of = data["asOf"]
    daily = item.get("daily") or {}
    if not daily:
        return None
    first_daily = min(daily)
    lo = max(add_days(start, -BEFORE_DAYS), first_daily, prev_change or first_daily)
    before_all = [k for k in ctx.dates if lo <= k < start and k in ctx.open]
    after_all = [k for k in ctx.dates if start <= k < min(as_of, add_days(start, MAX_AFTER_DAYS)) and k in ctx.open]
    days = ctx.days
    excluded_dates = [k for k in before_all + after_all if not ctx.fair(k)]
    before = [k for k in before_all if ctx.fair(k) and (days[k].get("orders") or 0) > 0]
    after = [k for k in after_all if ctx.fair(k) and (days[k].get("orders") or 0) > 0]
    # Days it didn't sell at all when we'd expect several: not on (86'd, keg kicked) — not a price effect.
    unavailable = []
    for period in (before, after):
        u = sum((daily.get(k) or [0, 0])[0] for k in period)
        o = sum(days[k]["orders"] for k in period)
        r = u / o if o else 0
        for k in list(period):
            if (daily.get(k) or [0, 0])[0] <= 0 and r * days[k]["orders"] >= UNAVAILABLE_EXPECTED:
                period.remove(k)
                unavailable.append(k)
    if len(before) < MIN_DAYS or len(after) < MIN_DAYS:
        return {"status": "wait", "after": len(after), "before": len(before)}
    rb_rows, ra_rows = _rows_for(daily, before, days), _rows_for(daily, after, days)
    units = sum(q for _, q, _ in rb_rows + ra_rows)
    if units < 30:
        return None
    R_b, R_a, wds = standardized_rate(rb_rows, ra_rows)
    if not wds or R_b <= 0 or R_a <= 0:
        return None
    wk = lambda dates: [(week_monday(k), weekday(k), float((daily.get(k) or [0, 0])[0]), float(days[k].get("orders") or 0)) for k in dates]
    sb, sa = bootstrap_weeks(wk(before), wk(after), B)
    A = math.log(R_a / R_b)
    A_s = np.log(np.maximum(sa, 1e-9) / np.maximum(sb, 1e-9))

    # Raw context numbers (what Max would see on his own reports)
    orders_b = float(np.mean([days[k]["orders"] for k in before]))
    orders_a = float(np.mean([days[k]["orders"] for k in after]))
    units_b = float(np.mean([(daily.get(k) or [0, 0])[0] for k in before]))
    units_a = float(np.mean([(daily.get(k) or [0, 0])[0] for k in after]))

    # Season: what the same weeks did in earlier years, for this item and for its category.
    n_b_wk = max(1, round(len({week_monday(k) for k in before})))
    n_a_wk = max(1, min(9, len({week_monday(k) for k in after})))
    w_orders = _weekly_orders(data)
    years = _season_baseline(item, start, n_b_wk, n_a_wk, w_orders, as_of)
    sibs = [s for s in (siblings or []) if s.get("daily") or s.get("weekly")]
    cat_years = _category_season(sibs, start, n_b_wk, n_a_wk, w_orders, as_of)
    rng = np.random.default_rng(13)
    control = None
    cat_season = None
    if cat_years:
        # Seasonal moves in an item's share over a couple of months are usually modest; a wild one
        # (menu or tap list reshuffled) is pulled toward "no move" by how noisy it is.
        c_raw = float(np.mean([y["change"] for y in cat_years]))
        c_se = float(np.std(np.mean(np.vstack([y["samples"] for y in cat_years]), axis=0)))
        if len(cat_years) > 1:
            c_se = math.sqrt(c_se**2 + (abs(cat_years[0]["change"] - cat_years[1]["change"]) / 2) ** 2)
        cat_season = shrink(c_raw, max(c_se, 0.02), 0.0, 0.2)[0]
    if years:
        # One item's history is noisy (a handful sold a week): its seasonal move is pulled toward the
        # category's (or toward "no move") by how noisy it is — the same idea as for price responses.
        own = float(np.mean([y["change"] for y in years]))
        own_s = np.mean(np.vstack([y["samples"] for y in years]), axis=0)
        own_se = float(np.std(own_s))
        if len(years) > 1:  # two years that disagree widen the range honestly
            own_se = math.sqrt(own_se**2 + (abs(years[0]["change"] - years[1]["change"]) / 2) ** 2)
        prior = cat_season if cat_season is not None else 0.0
        S, S_sd = shrink(own, max(own_se, 0.02), prior, SEASON_TAU if cat_season is not None else 0.2)
        S_s = rng.normal(S, S_sd, B)
        control = {"kind": "lastYear", "change": S, "own": own, "category": cat_season, "years": [{"years": y["years"], "before": y["before"], "after": y["after"], "change": y["change"]} for y in years]}
    elif cat_season is not None:
        S = cat_season
        S_s = rng.normal(S, FALLBACK_SD, B)  # the item may not move exactly like its category
        control = {"kind": "categoryLastYear", "change": S, "years": [{"years": y["years"], "before": y["before"], "after": y["after"], "change": y["change"]} for y in cat_years], "n": len(sibs)}
    else:
        S, S_s = 0.0, rng.normal(0, FALLBACK_SD, B)
        live = [s for s in sibs if s.get("daily")]
        if len(live) >= 3:
            cb = [(week_monday(k), weekday(k), float(sum((s["daily"].get(k) or [0, 0])[0] for s in live)), float(days[k]["orders"])) for k in before]
            ca = [(week_monday(k), weekday(k), float(sum((s["daily"].get(k) or [0, 0])[0] for s in live)), float(days[k]["orders"])) for k in after]
            cr_b, cr_a, _ = standardized_rate([r[1:] for r in cb], [r[1:] for r in ca])
            if cr_b > 0 and cr_a > 0:
                cs_b, cs_a = bootstrap_weeks(cb, ca, B, seed=31)
                S = math.log(cr_a / cr_b)
                S_s = np.log(np.maximum(cs_a, 1e-9) / np.maximum(cs_b, 1e-9))
                control = {"kind": "category", "change": S, "before": cr_b * 100, "after": cr_a * 100, "n": len(live)}
    E_s = A_s - S_s
    E = A - S
    lo_e, hi_e = float(np.nanpercentile(E_s, 2.5)), float(np.nanpercentile(E_s, 97.5))
    eff, eff_lo, eff_hi = math.exp(E) - 1, math.exp(lo_e) - 1, math.exp(hi_e) - 1
    clear = (hi_e < 0 or lo_e > 0) and abs(eff) >= MIN_EFFECT
    reason = None if clear else "range"
    # Timing: a price change works the day guests see it. If the first two weeks after didn't move the
    # same way, the later drift is something else (a tap change, the season turning, a menu change).
    first2 = [k for k in after if k < add_days(start, 14)]
    imm = None
    if len(first2) >= 5:
        i_b, i_a, _ = standardized_rate(rb_rows, _rows_for(daily, first2, days))
        if i_b > 0:
            imm = (math.log(i_a / i_b) if i_a > 0 else -3.0) - S
            if clear and len(after) > len(first2) + 5:
                # Is the overall effect outside what the first two weeks could plausibly show?
                i_sb, i_sa = bootstrap_rates(rb_rows, _rows_for(daily, first2, days), B, seed=17)
                imm_s = np.log(np.maximum(i_sa, 1e-9) / np.maximum(i_sb, 1e-9)) - S
                lo_i, hi_i = float(np.nanpercentile(imm_s, 5)), float(np.nanpercentile(imm_s, 95))
                if not (lo_i <= E <= hi_i) and (imm * E <= 0 or abs(imm) < 0.5 * abs(E)):
                    clear, reason = False, "timing"
    # Direction: a price rise doesn't sell more of something (nor a cut sell less). If it did, something
    # else moved it, so the price isn't credited with the volume.
    up = p_to > p_from
    implausible = clear and ((up and E > 0) or (not up and E < 0))
    E_money = 0.0 if implausible else E
    E_money_s = np.minimum(E_s, 0.0) if up else np.maximum(E_s, 0.0)

    # Weekdays where the item's share moved the same way (a steadiness check that reads well).
    same_dir = 0
    for w in wds:
        ob_w = sum(o for x, _, o in rb_rows if x == w)
        oa_w = sum(o for x, _, o in ra_rows if x == w)
        ub_w = sum(q for x, q, _ in rb_rows if x == w) / max(1e-9, ob_w)
        ua_w = sum(q for x, q, _ in ra_rows if x == w) / max(1e-9, oa_w)
        if ub_w <= 0:
            continue
        move = (math.log(ua_w / ub_w) if ua_w > 0 else -9.0) - S
        if (move < 0) == (E < 0):
            same_dir += 1

    # Money: profit at the new price vs what the old price would have earned at today's traffic.
    cost, cost_assumed = _unit_cost(item, p_to, data)
    opm = open_days_per_month(data.get("days", []))
    u_per_day = R_a * orders_a  # what the item sells on a normal day now, per the standardized rate
    def monthly(e_log):
        cf = u_per_day / np.exp(e_log)
        return (u_per_day * (p_to - cost) - cf * (p_from - cost)) * opm
    m_mid = float(monthly(E_money))
    profit_new = u_per_day * (p_to - cost) * opm
    profit_old = u_per_day / math.exp(E_money) * (p_from - cost) * opm
    m_s = monthly(E_money_s if not implausible else np.zeros(B))
    m_lo, m_hi = float(np.percentile(m_s, 2.5)), float(np.percentile(m_s, 97.5))

    # Substitution: did the rest of the category gain what this lost (beyond its own usual season)?
    subst = None
    base = _base_name(item["name"])
    sizes = [s for s in sibs if s.get("daily") and _base_name(s["name"]) == base]
    live = sizes or [s for s in sibs if s.get("daily")]
    if live and clear and abs(eff) >= MIN_EFFECT:
        cb = [(week_monday(k), weekday(k), float(sum((s["daily"].get(k) or [0, 0])[0] for s in live)), float(days[k]["orders"])) for k in before]
        ca = [(week_monday(k), weekday(k), float(sum((s["daily"].get(k) or [0, 0])[0] for s in live)), float(days[k]["orders"])) for k in after]
        cr_b, cr_a, _ = standardized_rate([r[1:] for r in cb], [r[1:] for r in ca])
        if cr_b > 0 and cr_a > 0:
            cs_b, cs_a = bootstrap_weeks(cb, ca, B, seed=41)
            c_season = cat_season or 0.0
            gain_s = cr_b * (np.exp(np.log(np.maximum(cs_a, 1e-9) / np.maximum(cs_b, 1e-9)) - c_season) - 1)  # per order, beyond season
            gain = cr_b * (math.exp(math.log(cr_a / cr_b) - c_season) - 1)
            lost = R_b * -eff  # per order; negative when the item gained
            # Switching shows up as the others moving the opposite way to this item.
            share = max(0.0, min(1.0, gain / lost)) if lost != 0 else 0.0
            clear_gain = (float(np.nanpercentile(gain_s, 5)) > 0) if lost > 0 else (float(np.nanpercentile(gain_s, 95)) < 0)
            aset = set(after)
            avg_price = sum(v[1] for s in live for k, v in s["daily"].items() if k in aset) / max(1e-9, sum(v[0] for s in live for k, v in s["daily"].items() if k in aset))
            sib_margin = avg_price * (1 - (TYPICAL_COST["beer"] if item.get("group") == "beverage" else 0.3))
            recaptured = (share * lost * orders_a * sib_margin * opm) if clear_gain else 0.0
            subst = {"sizes": bool(sizes), "base": base, "category": item.get("category"), "items": len(live), "before": cr_b * 100, "after": cr_a * 100, "season": c_season, "gainPer100": gain * 100, "lostPer100": lost * 100, "share": share, "clear": clear_gain, "recapturedMonthly": recaptured}

    return {
        "status": "ok",
        "clear": clear,
        "effect": eff, "effectLow": eff_lo, "effectHigh": eff_hi,
        "rawUnits": units_a / units_b - 1 if units_b else 0.0,
        "orders": (orders_b, orders_a), "units": (units_b, units_a), "per100": (R_b * 100, R_a * 100),
        "itemChange": math.exp(A) - 1, "control": control, "profitNew": profit_new, "profitOld": profit_old, "monthly": m_mid, "monthlyLow": m_lo, "monthlyHigh": m_hi,
        "netMonthly": m_mid + ((subst["recapturedMonthly"] if eff < 0 else -subst["recapturedMonthly"]) if subst and not implausible else 0.0),
        "subst": subst, "nBefore": len(before), "nAfter": len(after), "weekdays": len(wds), "sameDir": same_dir,
        "excluded": ctx.excluded_summary(excluded_dates), "unavailable": unavailable, "cost": cost, "costAssumed": cost_assumed,
        "years": years, "before": before, "after": after, "halfWidth": (hi_e - lo_e) / 2,
        "reason": reason, "immediate": (math.exp(imm) - 1) if imm is not None else None, "first2": len(first2), "implausible": implausible, "up": up,
    }


def _category_season(sibs: list[dict], start: str, n_b: int, n_a: int, w_orders: dict[str, float], as_of: str) -> list[dict]:
    """The category's seasonal move in earlier years, from the items that were selling steadily
    through those weeks then (so items added or dropped since don't fake a seasonal swing)."""
    out = []
    s_mon = week_monday(start)
    for k in (1, 2):
        shift = 364 * k
        weeks = [add_days(s_mon, -shift - 7 * j) for j in range(n_b, 0, -1)] + [add_days(s_mon, -shift + 7 * j) for j in range(n_a)]
        steady = [x for x in sibs if sum(1 for w in weeks if ((x.get("weekly") or {}).get(w) or [0, 0])[0] > 0) >= 0.75 * len(weeks)]
        if len(steady) < 2:
            continue
        r = _season_baseline({"weekly": _sum_weekly(steady)}, start, n_b, n_a, w_orders, as_of, years=(k,))
        out += r
    return out


def _base_name(name: str) -> str:
    """'New York Nectar* · Half Pour (9 oz)' → 'new york nectar' (sizes of the same thing)."""
    return name.split(" · ")[0].split(" | ")[0].split(" (")[0].replace("*", "").strip().lower()


def _sum_weekly(items: list[dict]) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for s in items:
        for k, v in (s.get("weekly") or {}).items():
            cur = out.setdefault(k, [0.0, 0.0])
            cur[0] += v[0]
            cur[1] += v[1]
    return out


def _series(data: dict, item: dict, m: dict) -> dict:
    """Weekly units per 100 orders around the change, with last year's same weeks for reference."""
    w_orders = _weekly_orders(data)
    weekly = item.get("weekly") or {}
    daily = item.get("daily") or {}
    weeks = sorted({week_monday(k) for k in m["before"] + m["after"]})
    pts = []
    ly = {w: v for y in m["years"][:1] for w, v in y["series"]}
    for w in weeks:
        o = w_orders.get(w) or 0
        q = (weekly.get(w) or [None])[0]
        if q is None:
            q = sum((daily.get(k) or [0, 0])[0] for k in [add_days(w, i) for i in range(7)])
        if o <= 0:
            continue
        p = {"x": w, "y": round(q / o * 100, 2)}
        lw = add_days(w, -364)
        if lw in ly:
            p["ref"] = round(ly[lw], 2)
        pts.append(p)
    return pts


def describe(data: dict, item: dict, start: str, p_from: float, p_to: float, m: dict) -> dict:
    """Turn a measurement into a finding (or a watch-list entry) with its evidence."""
    as_of = data["asOf"]
    name = item["name"]
    short = name.split(" · ")[0].split(" | ")[0]
    up = p_to > p_from
    verb = "raising" if up else "cutting"
    delta = exact_money(abs(p_to - p_from)) if abs(p_to - p_from) >= 1 and abs(p_to - p_from - round(p_to - p_from)) < 0.005 else f"${abs(p_to - p_from):.2f}"
    when = nice_date(start, as_of)
    what = f"{verb} the {name} {delta}"
    ob, oa = m["orders"]
    ub, ua = m["units"]
    rb, ra = m["per100"]
    eff, lo, hi = m["effect"], m["effectLow"], m["effectHigh"]
    ctl = m["control"]
    traffic = oa / ob - 1 if ob else 0.0
    rows = [
        row("Orders per open day (how busy you were)", num_words(ob, 0), num_words(oa, 0), traffic),
        row(f"{short} sold per open day", num_words(ub), num_words(ua), m["rawUnits"]),
        row(f"{short} per 100 orders (same weekday mix)", num_words(rb, 2), num_words(ra, 2), m["itemChange"], strong=True),
    ]
    steps = []
    if ctl and ctl["kind"] in ("lastYear", "categoryLastYear"):
        who = short if ctl["kind"] == "lastYear" else f"rest of the {item.get('category') or 'category'}"
        for y in ctl["years"]:
            rows.append(row(f"Same weeks {'last year' if y['years'] == 1 else '2 years ago'}: {who} per 100 orders", num_words(y["before"], 2), num_words(y["after"], 2), math.exp(y["change"]) - 1, note="no price change then — what the time of year usually does"))
        if ctl["kind"] == "lastYear":
            own_txt = f"In the same weeks {'last year' if len(ctl['years']) == 1 else 'of earlier years'} its share moved {pct_words(math.exp(ctl['own']) - 1)} with no price change"
            if ctl.get("category") is not None:
                rows.append(row(f"Same weeks, rest of the {item.get('category') or 'category'}", value=pct_words(math.exp(ctl["category"]) - 1)))
                season_txt = own_txt + f"; the rest of the {item.get('category') or 'category'} moved {pct_words(math.exp(ctl['category']) - 1)}. One item's history is noisy, so we blend the two: this time of year usually means about {pct_words(math.exp(ctl['change']) - 1)} for it"
            else:
                season_txt = own_txt + f". One item's history is noisy, so we count a little less of it: about {pct_words(math.exp(ctl['change']) - 1)}"
            rows.append(row("What the time of year usually does to it", value=pct_words(math.exp(ctl["change"]) - 1)))
        else:
            season_txt = f"The {short} wasn't sold in these weeks in an earlier year, so we used the rest of the {item.get('category') or 'category'} then: it moved {pct_words(math.exp(ctl['change']) - 1)} with the season"
    elif ctl and ctl["kind"] == "category":
        rows.append(row(f"Rest of {item.get('category') or 'its category'} per 100 orders", num_words(ctl["before"], 2), num_words(ctl["after"], 2), math.exp(ctl["change"]) - 1, note=f"{ctl['n']} other items, same days"))
        season_txt = f"There's no record of these weeks in an earlier year, so we used the rest of the {item.get('category') or 'category'} as the yardstick: it moved {pct_words(math.exp(ctl['change']) - 1)} over the same days"
    else:
        season_txt = "There's no earlier year and no similar items to compare with, so the season isn't allowed for — the range is wider because of it"
    if m.get("immediate") is not None:
        rows.append(row("First two weeks after the change (after season)", value=pct_words(m["immediate"]), note="a price change works the day guests see it"))
    rows.append(row("What the price change did, after allowing for all that", value=f"{pct_words(eff)} (likely {range_words(lo, hi)})", strong=True))
    if abs(traffic) >= 0.03:
        steps.append(f"The place was {'quieter' if traffic < 0 else 'busier'} after the change: {num_words(ob, 0)} orders an open day before, {num_words(oa, 0)} after ({pct_words(traffic)}). So we compare the {short} per 100 orders instead of raw counts.")
    else:
        steps.append(f"How busy you were barely changed ({num_words(ob, 0)} → {num_words(oa, 0)} orders an open day), so the raw counts and the per-order numbers tell a similar story.")
    steps.append(f"Per 100 orders, with the weekday mix held the same, the {short} went from {num_words(rb, 2)} to {num_words(ra, 2)} ({pct_words(m['itemChange'])}).")
    steps.append(season_txt + ".")
    steps.append(f"So the price change itself explains about {pct_words(eff)} (likely {range_words(lo, hi)}).")
    sub = m.get("subst")
    if sub and sub["lostPer100"] != 0:
        others = f"other sizes of the {short}" if sub.get("sizes") else f"rest of the {sub['category'] or 'category'}"
        if sub["lostPer100"] > 0:
            if sub["clear"] and sub["share"] >= 0.2:
                steps.append(f"Some guests switched rather than skipped: the {others} picked up about {num_words(sub['gainPer100'], 2)} per 100 orders beyond the season — roughly {round(sub['share'] * 100)}% of what the {short} lost. That margin isn't lost to you, so it's counted back.")
            else:
                steps.append(f"The {others} didn't clearly pick up what the {short} lost ({num_words(sub['before'], 2)} → {num_words(sub['after'], 2)} per 100 orders), so we don't assume guests just switched.")
        else:
            if sub["clear"] and sub["share"] >= 0.2:
                steps.append(f"Much of it came from guests switching: the {others} lost about {num_words(-sub['gainPer100'], 2)} per 100 orders beyond the season — roughly {round(sub['share'] * 100)}% of what the {short} gained. That margin moved rather than grew, so it's taken off.")
            else:
                steps.append(f"The {others} didn't clearly lose what the {short} gained ({num_words(sub['before'], 2)} → {num_words(sub['after'], 2)} per 100 orders), so the extra sales look like new ones.")
        rows.append(row(f"The {others}, per 100 orders", num_words(sub["before"], 2), num_words(sub["after"], 2), sub["after"] / sub["before"] - 1 if sub["before"] else None, note="did guests switch?"))
    excluded = list(m["excluded"])
    if m["unavailable"]:
        excluded.append(f"{plural(len(m['unavailable']), 'day')} it didn't sell at all when it normally would (probably off — 86'd or the keg kicked)")
    method = f"We compared the {short}'s sales per 100 orders on fair days in the {plural(m['nBefore'], 'open day')} before and the {plural(m['nAfter'], 'open day')} after {when}, with each weekday counted equally, then took off what usually happens to it at this time of year."
    effect = {"mid": eff, "low": lo, "high": hi, "label": f"Effect of the price change on {short} sales per guest"}
    chart = {"type": "series", "unit": "per100", "label": f"{short} per 100 orders, week by week", "refLabel": "Same weeks last year" if m["years"] else None, "marker": week_monday(start), "markerLabel": "Price changed", "points": _series(data, item, m)}
    gain = m["netMonthly"]
    if not m["clear"]:
        # Not distinguishable from normal ups and downs → watch list, not an action.
        if m.get("reason") == "timing":
            summary = f"Relative to how busy you were, the {short} sells {pct_words(eff)} since {when} — but the first two weeks after the price change were {pct_words(m['immediate'])}, so it didn't move when the price did. Something else is more likely behind it (a tap or menu change, the season turning)."
            steps.append(f"But a price change works the day guests see it, and the first two weeks after it were {pct_words(m['immediate'])}. The move came later, so we can't pin it on the price.")
        elif abs(eff) >= 0.1:
            summary = (f"Sales {'fell' if traffic < 0 else 'rose'} overall then too ({pct_words(traffic)} orders a day). " if abs(traffic) >= 0.05 else "") + f"Relative to how busy you were, the {short} sold {pct_words(eff)} — but its sales swing a lot from week to week, so we can't yet tell that apart from normal ups and downs (likely {range_words(lo, hi)})."
        elif abs(traffic) >= 0.05 and abs(m["rawUnits"]) >= 0.08:
            summary = f"Sales {'fell' if traffic < 0 else 'rose'} overall then too ({pct_words(traffic)} orders a day). Relative to how busy you were, the {short} sold about the same — no clear effect of the price change."
        else:
            summary = f"Relative to how busy you were and the time of year, the {short} sold about the same since the price change — no clear effect either way."
        hw = m["halfWidth"]
        if abs(eff) >= 0.03 and hw > 0:
            need_days = m["nAfter"] * (hw / abs(math.log(1 + eff))) ** 2
            more = max(7, int(math.ceil(need_days - m["nAfter"])))
            watch = f"If the {pct_words(eff)} holds, about {plural(math.ceil(more / 6), 'more week')} of sales will tell whether it's real." if more < 120 else f"It would count if it moved by more than {pct_words(hi if eff > 0 else lo)} relative to how busy you are."
        else:
            watch = f"It would count if the {short} moved by more than about {round(max(abs(lo), abs(hi)) * 100)}% relative to how busy you are."
        sure = sure_line("low", f"the likely range ({range_words(lo, hi)}) includes no change at all, so we can't tell the price change apart from normal week-to-week ups and downs." if m.get("reason") != "timing" else "the timing doesn't fit a price effect.")
        if m.get("reason") == "timing":
            watch = f"We'll keep watching the {short}; if it keeps sliding, check what else changed around {nice_date(add_days(start, 14), as_of)}."
        ev = evidence(verdict="unclear", summary=summary, rows=rows, steps=steps, excluded=excluded, method=method, sure=sure, effect=effect, chart=chart, watch=watch)
        o = opportunity(f"feed.follow.{item['id']}.{start}", "feed.follow.watch", "feed", f"Since {what} on {when}: " + ("the timing doesn't fit the price" if m.get("reason") == "timing" else "no clear effect yet"), "Nothing to do — we're watching it.", 0.0, 0.0, 0.0, 0.2, [summary], [inp("Effect (after allowing for traffic and season)", f"{pct_words(eff)} ({range_words(lo, hi)})")], href="/insights#lab-price", subject=item["id"], area="menu", effort="easy", vector="info")
        o["evidence"] = ev
        o["status"] = "watching"
        o["watch"] = watch
        return o
    level = "high" if m["sameDir"] >= max(3, 0.75 * m["weekdays"]) and m["nAfter"] >= 21 else "medium"
    sure = sure_line(level, f"the likely range ({range_words(lo, hi)}) stays {'below' if eff < 0 else 'above'} zero, and the {short} moved that way on {m['sameDir']} of {m['weekdays']} weekdays." + ("" if m["nAfter"] >= 21 else f" It's only {plural(m['nAfter'], 'open day')} since the change, so the dollars could still move."))
    vol = eff
    vol_txt = "about the same per guest" if abs(vol) < 0.05 else f"{abs(vol) * 100:.0f}% {'more' if vol > 0 else 'fewer'} sold for how busy you were"
    if m.get("implausible"):
        vol_txt = "sales held up"
        steps.append(f"A price {'rise' if up else 'cut'} doesn't usually {'sell more' if up else 'sell less'} of something, so we don't credit the price with that — something else moved it. We only count the {'extra' if up else 'lost'} {delta} on what you sold.")
        sure = sure_line("medium", f"sales of the {short} clearly held up after the price change, so the {'extra' if up else 'lost'} margin is real; the {'rise' if up else 'drop'} in sales is down to something else.")
    title = f"Since {what} on {when}: {'+' if gain >= 0 else '−'}{money(abs(gain))} a month, {vol_txt}"
    summary = f"Relative to how busy you were and the time of year, the {short} sells {pct_words(eff)} since the price change (likely {range_words(lo, hi)})."
    ev = evidence(verdict="good" if gain >= 0 else "real", summary=summary, rows=rows + [row("Profit on it, a month, vs keeping the old price", value=f"{'+' if gain >= 0 else '−'}{money(abs(gain))} (likely {money(m['monthlyLow'])} to {money(m['monthlyHigh'])})")], steps=steps + [f"Money: about {num_words(ra * oa / 100)} sold an open day now at {exact_money(p_to) if p_to >= 10 else f'${p_to:.2f}'} vs {num_words(ra * oa / 100 / (1 + eff))} we'd expect at the old price, after a {'typical' if m['costAssumed'] else 'plate'} cost of ${m['cost']:.2f} each, × {open_days_per_month(data.get('days', [])):.0f} open days a month."], excluded=excluded, method=method, sure=sure, effect=effect, chart=chart)
    conf = 0.65 if level == "high" else 0.5
    a, b = abs(m["monthlyLow"]), abs(m["monthlyHigh"])
    same_sign = (m["monthlyLow"] >= 0) == (m["monthlyHigh"] >= 0)
    lo_m, hi_m = (min(a, b) if same_sign else 0.0), max(a, b, abs(gain))
    o = opportunity(
        f"feed.follow.{item['id']}.{start}", "feed.follow", "feed", title,
        "Keep it." if gain >= 0 else "Consider putting the price back.",
        abs(gain), lo_m, hi_m, conf,
        [summary, method], [inp("Orders a day", f"{ob:.0f} → {oa:.0f}"), inp(f"{short} per 100 orders", f"{rb:.2f} → {ra:.2f}"), inp("Effect after traffic and season", f"{pct_words(eff)} ({range_words(lo, hi)})")],
        href="/insights#lab-price", subject=item["id"], area="menu", effort="easy", vector="info" if gain > -60 else "earn",
        story=story(
            f"On {when} you started {what}.",
            summary + (f" (Raw counts said {pct_words(m['rawUnits'])}, but {'fewer' if traffic < 0 else 'more'} people came in.)" if abs(m["rawUnits"] - eff) >= 0.05 else ""),
            "Keep it." if gain >= 0 else f"Consider putting the {short} back to {exact_money(p_from) if p_from >= 10 else f'${p_from:.2f}'}.",
            f"{'+' if gain >= 0 else '−'}{money(abs(gain))} a month so far, compared with keeping the old price.",
        ),
        visual={"type": "compare", "unit": "money", "rows": [{"label": "Profit a month on it at the old price (today's traffic)", "value": round(m["profitOld"])}, {"label": "At the new price", "value": round(m["profitNew"]), "tone": "good" if gain >= 0 else "bad"}]},
    )
    o["evidence"] = ev
    return o
