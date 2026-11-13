"""Order quantities (the newsvendor model).

For each ingredient on its next order:
- demand until the delivery after next is a Gamma distribution whose mean is
  the forecast usage and whose spread comes from how much daily usage has
  wobbled around its weekday average;
- running short costs the margin on the dishes you can't sell
  (`marginPerBase`), over-ordering costs the ingredient if it spoils before the
  next delivery (shelf life by category) or ~3% if it keeps;
- we pick the whole number of packs with the lowest expected cost, simulated
  over 4,000 demand draws, and compare it with today's suggestion.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

from .common import WEEKS_PER_MONTH, confidence, inp, insight, money, opportunity

MAX_STOCKOUT = 0.10
SHELF_LIFE_DAYS = {"produce": 5, "dairy": 12, "protein": 4, "meat": 4, "seafood": 2, "bakery": 3, "bread": 3, "frozen": 120, "pantry": 180, "dry": 180, "beer": 45, "beverage": 60}


def shelf_life(category: str | None, explicit: float | None = None) -> float:
    if explicit:
        return float(explicit)
    c = (category or "").lower()
    for k, v in SHELF_LIFE_DAYS.items():
        if k in c:
            return float(v)
    return 30.0


def usage_cv(usage: dict[str, float]) -> float:
    """Coefficient of variation of daily usage around its weekday mean (floored at 15%)."""
    from .common import weekday

    vals = [(weekday(k), v) for k, v in usage.items() if v > 0]
    if len(vals) < 10:
        return 0.35
    by = {}
    for w, v in vals:
        by.setdefault(w, []).append(v)
    rel = [v / np.mean(by[w]) - 1 for w, v in vals if len(by[w]) >= 2 and np.mean(by[w]) > 0]
    return float(max(0.15, np.std(rel))) if rel else 0.35


def demand_samples(mean: float, daily: list[float], cv: float, n: int = 4000, seed: int = 7) -> np.ndarray:
    """Gamma draws for total demand over the window. Daily errors are assumed 50% correlated (busy weeks are busy)."""
    if mean <= 0:
        return np.zeros(n)
    var_ind = sum((cv * x) ** 2 for x in daily)
    var_cor = (cv * sum(daily)) ** 2
    var = 0.5 * var_ind + 0.5 * var_cor
    k = mean**2 / max(var, 1e-9)
    rng = np.random.default_rng(seed)
    return stats.gamma.rvs(a=k, scale=mean / k, size=n, random_state=rng)


def expected_cost(stock: float, demand: np.ndarray, cu: float, co: float) -> dict:
    short = np.maximum(demand - stock, 0)
    over = np.maximum(stock - demand, 0)
    return {"cost": float(cu * short.mean() + co * over.mean()), "stockout": float((short > 0).mean()), "over": float(over.mean()), "short": float(short.mean())}


def plan(ing: dict) -> dict | None:
    pack = ing.get("packQty") or 0
    pack_cost = ing.get("packCost") or 0
    if pack <= 0 or pack_cost <= 0 or not ing.get("onHandKnown"):
        return None
    daily = [max(0.0, float(x)) for x in ing.get("forecast") or []]
    mean = sum(daily)
    if mean <= 0:
        return None
    cpb = pack_cost / pack
    life = shelf_life(ing.get("category"), ing.get("shelfLifeDays"))
    cover = max(1, int(ing.get("coverDays") or len(daily)))
    # Leftovers spoil if they won't be used up before going off.
    co = cpb * (1.0 if life <= cover * 1.5 else 0.03)
    # Half the guests who can't get a dish order something else, so a shortage loses half its margin.
    cu = max(0.5 * float(ing.get("marginPerBase") or 0.0), cpb * 1.5)
    cv = usage_cv(ing.get("usage") or {})
    demand = demand_samples(mean, daily, cv)
    on_hand = max(0.0, float(ing.get("onHand") or 0))
    cur = int(ing.get("currentPacks") or 0)
    options = []
    for n in range(0, max(cur, math.ceil(max(0, mean * 2 - on_hand) / pack)) + 3):
        e = expected_cost(on_hand + n * pack, demand, cu, co)
        options.append({"packs": n, **e})
    # Never suggest worse than a 1-in-10 chance of running out — a lost Saturday costs more than margin.
    safe = [o for o in options if o["stockout"] <= MAX_STOCKOUT]
    best = min(safe, key=lambda o: o["cost"]) if safe else min(options, key=lambda o: o["stockout"])
    now = options[cur] if cur < len(options) else expected_cost(on_hand + cur * pack, demand, cu, co) | {"packs": cur}
    weekly = (now["cost"] - best["cost"]) / cover * 7
    waste_weekly = (now["over"] - best["over"]) * co / cover * 7
    return {
        "id": ing["id"],
        "name": ing["name"],
        "unit": ing.get("purchaseUnit") or "case",
        "current": cur,
        "best": best["packs"],
        "stockoutBest": best["stockout"],
        "stockoutNow": now["stockout"],
        "savingWeekly": weekly,
        "wasteSavingWeekly": waste_weekly,
        "criticalRatio": cu / (cu + co),
        "cu": cu,
        "co": co,
        "mean": mean,
        "cv": cv,
        "onHand": on_hand,
        "pack": pack,
        "packCost": pack_cost,
        "shelfLife": life,
        "coverDays": cover,
        "supplier": ing.get("supplier"),
        "baseUnit": ing.get("baseUnit"),
    }


def odds(p: float) -> str:
    if p < 0.005:
        return "almost no chance"
    n = round(1 / p)
    return f"a 1-in-{n} chance" if n >= 2 else f"a {round(p * 100)}% chance"


def plural(unit: str, n: int) -> str:
    if n == 1:
        return unit
    return unit + ("es" if unit.endswith(("s", "x", "ch", "sh")) else "s")


def run(data: dict) -> dict:
    ings = data.get("ingredients", [])
    plans = [p for p in (plan(i) for i in ings) if p]
    n_days = len([x for x in data.get("days", []) if x.get("open")])
    skipped = [i["name"] for i in ings if not i.get("onHandKnown")]
    if not plans:
        return insight("orders", "Order quantities", status="thin", headline="Needs a stock count and pack sizes to size orders.", action="Do a count on the Count page; next order gets sized automatically.", how=["Order sizes need what's on the shelf (a count), what one pack holds and its price."], details={"skipped": skipped})
    changes = [p for p in plans if p["best"] != p["current"] and p["savingWeekly"] > 5]
    changes.sort(key=lambda p: -p["savingWeekly"])
    conf = confidence(n_days, 0.1)
    opps = []
    for p in changes[:5]:
        less = p["best"] < p["current"]
        verb = f"Order {p['best']} {plural(p['unit'], p['best'])} of {p['name']} (not {p['current']})"
        risk = odds(p["stockoutBest"])
        why = f"saves ~{money(p['savingWeekly'])}/week in {'waste' if less else 'lost sales'} with {risk} of running out" if less else f"cuts the chance of running out from {odds(p['stockoutNow'])} to {risk} — worth ~{money(p['savingWeekly'])}/week"
        opps.append(opportunity(f"orders.size.{p['id']}", "orders.size", "orders", f"{verb} — {why}", f"{verb} on the next {p.get('supplier') or 'supplier'} order.", p["savingWeekly"] * WEEKS_PER_MONTH, p["savingWeekly"] * WEEKS_PER_MONTH * 0.5, p["savingWeekly"] * WEEKS_PER_MONTH * 1.3, conf["score"] * 0.9,
                                [f"Expected use from this delivery to the next one: {p['mean'] / p['pack']:.1f} {plural(p['unit'], 2)} (day-to-day wobble {round(p['cv'] * 100)}%). Expected on hand when it arrives: {p['onHand'] / p['pack']:.1f}.", f"Running short costs about ${p['cu'] * p['pack']:.0f} per {p['unit']} in lost margin (half of guests pick something else); a leftover {p['unit']} costs ${p['co'] * p['pack']:.0f} ({'it spoils in ~' + str(int(p['shelfLife'])) + ' days' if p['co'] > p['packCost'] / p['pack'] * 0.5 else 'it keeps'}). The best balance is {p['best']}."],
                                [inp("Pack", f"{p['unit']} at ${p['packCost']:.2f}"), inp("Forecast use", f"{p['mean'] / p['pack']:.2f} {plural(p['unit'], 2)}"), inp("On hand", f"{p['onHand'] / p['pack']:.2f}"), inp("Shelf life", f"{int(p['shelfLife'])} days"), inp("Today's suggestion", p["current"])], href="/ordering", subject=p["id"]))
    total = sum(p["savingWeekly"] for p in changes) * WEEKS_PER_MONTH
    if opps:
        headline = opps[0]["title"]
        action = opps[0]["action"]
    else:
        headline = f"Today's suggested orders already look right for all {len(plans)} items we could check"
        action = "Order as suggested."
    how = [
        "For each ingredient we asked: how much will you use between this delivery and the next one, and how sure are we? Expected use comes from the item forecast × recipe quantities; the spread comes from how much daily use has wobbled around its usual weekday level.",
        "Then we weighed two costs: running out (you lose the margin on dishes you can't sell) and ordering too much (if it spoils before you'd use it, you lose what you paid; if it keeps, it only ties up cash).",
        "We simulated 4,000 possible weeks and picked the number of packs with the lowest expected cost, never accepting worse than a 1-in-10 chance of running out. Perishables lean lean; things that keep lean generous.",
        "Shelf lives are typical for the category (produce ~5 days, dairy ~12, fresh protein ~4, bread ~3, frozen and dry goods months).",
    ]
    if skipped:
        how.append(f"Not checked until they're counted: {', '.join(skipped[:8])}{'…' if len(skipped) > 8 else ''}.")
    return insight(
        "orders",
        "Order quantities",
        headline=headline,
        action=action,
        monthly=total if total > 0 else None,
        range=[total * 0.5, total * 1.3] if total > 0 else None,
        confidence=conf,
        how=how,
        inputs=[inp(p["name"], f"suggested {p['current']}, best {p['best']} {plural(p['unit'], 2)}; run-out risk {round(p['stockoutBest'] * 100)}%") for p in plans],
        chart={"type": "bars", "unit": "money", "rows": [{"label": p["name"], "value": round(p["savingWeekly"] * WEEKS_PER_MONTH, 0)} for p in changes[:6]]} if changes else None,
        details={"plans": plans, "skipped": skipped},
        opportunities=opps,
    )
