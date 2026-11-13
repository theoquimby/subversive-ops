"""Menu engineering (Kasavana & Smith, 1982).

Each item is placed on two axes within its group (food or drinks):
- popularity: its share of items sold vs 70% of an even share (1/N × 0.7);
- contribution margin (price − plate cost) vs the volume-weighted average.

Star (popular, high margin) · Workhorse (popular, low margin) · Puzzle
(unpopular, high margin) · Dog (unpopular, low margin). Each class has one
action, priced in $/month with the fitted price response.
"""

from __future__ import annotations

import math

from . import price as price_model
from .common import add_days, confidence, exact_money, inp, insight, money, open_days_per_month, opportunity, pct

PLAIN = {"Star": "Star", "Workhorse": "Crowd-pleaser", "Puzzle": "Hidden gem", "Dog": "Rethink"}

ACTIONS = {
    "Star": "Keep it exactly as it is and keep it where guests see it first.",
    "Workhorse": "Guests love it but it earns too little — raise the price a little or trim the plate cost.",
    "Puzzle": "It earns well but few order it — move it up the menu, rename it, or have servers suggest it.",
    "Dog": "Low sales and low margin — rework it or take it off.",
}


def price_str(p: float) -> str:
    return f"${p:.0f}" if abs(p - round(p)) < 0.005 else f"${p:.2f}"


def classify(rows: list[dict]) -> list[dict]:
    """Adds mix, popular, highMargin and cls to each row ({qty, cm}). Pure function."""
    total = sum(r["qty"] for r in rows)
    n = len(rows)
    if total <= 0 or n == 0:
        return rows
    pop_cut = 0.7 / n
    avg_cm = sum(r["qty"] * r["cm"] for r in rows) / total
    for r in rows:
        r["mix"] = r["qty"] / total
        r["popular"] = r["mix"] >= pop_cut
        r["highMargin"] = r["cm"] >= avg_cm
        r["cls"] = {(True, True): "Star", (True, False): "Workhorse", (False, True): "Puzzle", (False, False): "Dog"}[(r["popular"], r["highMargin"])]
        r["popCut"] = pop_cut
        r["avgCm"] = avg_cm
    return rows


def best_price(price: float, cost: float, qty_month: float, e: float, e_sd: float, max_up: float = 0.12) -> dict | None:
    """Best price on a 50¢ grid up to +12% (and +$3), chosen with a cautious (more elastic) response."""
    cautious = e - e_sd
    best = None
    step = 0.5
    k = 1
    while True:
        p1 = math.floor((price + k * step) * 2 + 1e-9) / 2
        if p1 > price * (1 + max_up) + 1e-9 or p1 - price > 3.0 + 1e-9:
            break
        g_c = price_model.what_if(price, cost, qty_month, cautious, p1 - price)["profit"]
        if g_c > 0 and (best is None or g_c > best["cautious"]):
            mid = price_model.what_if(price, cost, qty_month, e, p1 - price)
            hi = price_model.what_if(price, cost, qty_month, min(-0.01, e + e_sd), p1 - price)["profit"]
            best = {"price": p1, "gain": mid["profit"], "cautious": g_c, "high": hi, "qty": mid["qty"]}
        k += 1
    return best


def analyse(data: dict, elastic: dict[str, dict], window: int) -> dict:
    as_of = data["asOf"]
    since = add_days(as_of, -window)
    opm = open_days_per_month(data.get("days", []))
    n_open = len([x for x in data.get("days", []) if x.get("open") and x["date"] >= since])
    rows, bad_cost = [], []
    for it in data.get("items", []):
        if it.get("kind") != "MENU":
            continue
        daily = {k: v for k, v in (it.get("daily") or {}).items() if k >= since}
        qty = sum(v[0] for v in daily.values())
        sales = sum(v[1] for v in daily.values())
        if qty <= 0:
            continue
        p = sales / qty
        cost = it.get("unitCost")
        if cost is None or it.get("costIncomplete") or cost >= 0.9 * p:
            bad_cost.append({"id": it["id"], "name": it["name"], "cost": cost, "price": p})
            continue
        rows.append({"id": it["id"], "name": it["name"], "group": it.get("group") or "food", "category": it.get("category"), "qty": qty, "qtyMonth": qty / max(1, n_open) * opm, "price": p, "listPrice": it.get("price") or p, "cost": cost, "cm": p - cost})
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["group"], []).append(r)
    # Compare like with like (food with food, drinks with drinks). A group with fewer than 3 items can't be compared.
    small = [r for g in groups.values() if len(g) < 3 for r in g]
    groups = {k: g for k, g in groups.items() if len(g) >= 3}
    if not groups and rows:
        groups, small = {"menu": rows}, []
    rows = [r for g in groups.values() for r in g]
    for g in groups.values():
        classify(g)
    return {"rows": rows, "small": [{"id": r["id"], "name": r["name"], "group": r["group"]} for r in small], "badCost": bad_cost, "openDays": n_open, "groups": {k: [r["id"] for r in v] for k, v in groups.items()}}


def run(data: dict, price_result: dict | None = None) -> dict:
    elastic = price_model.elasticity_map(price_result or price_model.run(data))
    n_hist = len([x for x in data.get("days", []) if x.get("open")])
    a30 = analyse(data, elastic, 30)
    a90 = analyse(data, elastic, 90)
    rows = a30["rows"]
    if len(rows) < 3:
        return insight("menu", "Menu", status="thin", headline="Needs at least 3 costed menu items with sales.", action="Link Square items to recipes and price their ingredients.", how=["Menu engineering compares items against each other, so it needs a few costed items with sales."], details={"badCost": a30["badCost"]})
    cls90 = {r["id"]: r.get("cls") for r in a90["rows"]}
    opps = []
    for r in rows:
        e = elastic.get(r["id"], {"elasticity": -0.9, "sd": 0.35, "source": "typical"})
        r["elasticity"], r["eSource"] = e["elasticity"], e["source"]
        r["cls90"] = cls90.get(r["id"])
        r["action"] = ACTIONS[r["cls"]]
        r["move"] = None
        if r["cls"] in ("Workhorse", "Star"):
            bp = best_price(r["listPrice"], r["cost"], r["qtyMonth"], e["elasticity"], e["sd"], 0.12 if r["cls"] == "Workhorse" else 0.06)
            if bp and bp["gain"] > 15:
                r["move"] = {"kind": "reprice", **bp}
                title = f"Reprice the {r['name']} to {price_str(bp['price'])} → about +{money(bp['gain'])}/month"
                opps.append(opportunity(f"menu.reprice.{r['id']}", "menu.reprice", "menu", title, f"Change the {r['name']} from ${r['listPrice']:.2f} to ${bp['price']:.2f} in Square. Expect ~{(1 - bp['qty'] / r['qtyMonth']) * 100:.0f}% fewer sold; it still pays.", bp["gain"], bp["cautious"], bp["high"], 0.55 if e["source"] == "measured" else 0.4,
                                        [f"{r['name']} is a {PLAIN[r['cls']].lower()}: {pct(r['mix'])} of {r['group']} items sold (cut-off {pct(r['popCut'])}) with a ${r['cm']:.2f} margin (average ${r['avgCm']:.2f}).", f"At ${bp['price']:.2f}, allowing for how guests react to price ({'measured from your own price changes' if e['source'] == 'measured' else 'typical for this kind of item'}), you'd sell about {bp['qty']:.0f} a month instead of {r['qtyMonth']:.0f} and keep {money(bp['gain'])} more. The low end assumes guests are more price-sensitive than we think."],
                                        [inp("Sold, last 30 days", f"{r['qty']:.0f}"), inp("Average price", f"${r['price']:.2f}"), inp("Plate cost", f"${r['cost']:.2f}"), inp("Margin", f"${r['cm']:.2f}"), inp("How guests react to price", "measured" if e["source"] == "measured" else "typical")], subject=r["id"]))
        elif r["cls"] == "Puzzle":
            target_qty = r["popCut"] * sum(x["qty"] for x in rows if x["group"] == r["group"] or len(a30["groups"]) == 1)
            extra_month = max(0.0, (target_qty - r["qty"])) / max(1, a30["openDays"]) * open_days_per_month(data.get("days", []))
            gain = extra_month * max(0.0, r["cm"] - r["avgCm"])  # each extra one mostly replaces an average-margin item
            r["move"] = {"kind": "promote", "gain": gain, "extra": extra_month}
            if gain > 15:
                opps.append(opportunity(f"menu.promote.{r['id']}", "menu.promote", "menu", f"Sell more {r['name']} → up to +{money(gain)}/month", f"Move the {r['name']} to the top of its section and have servers mention it; aim for {extra_month / 4.3:.0f} more a week.", gain, gain * 0.3, gain, 0.3,
                                        [f"It earns ${r['cm']:.2f} a plate vs ${r['avgCm']:.2f} on average but only {pct(r['mix'])} of items sold. If it reached the popularity cut-off ({pct(r['popCut'])}) and each extra sale replaced an average item, you'd keep the margin difference."],
                                        [inp("Margin", f"${r['cm']:.2f}"), inp("Average margin", f"${r['avgCm']:.2f}"), inp("Extra sold per month", f"{extra_month:.0f}")], subject=r["id"]))
        elif r["cls"] == "Dog":
            r["move"] = {"kind": "rework", "gain": 0.0}
    opps.sort(key=lambda o: -o["monthly"])
    counts = {c: sum(1 for r in rows if r["cls"] == c) for c in ACTIONS}
    shifted = [r for r in rows if r.get("cls90") and r["cls90"] != r["cls"]]
    conf = confidence(n_hist, 0.05 if all(r["eSource"] == "typical" for r in rows) else 0.0)
    if opps:
        top = opps[0]
        headline = top["title"] + " at today's volume"
        action = top["action"]
        monthly, rng = top["monthly"], [top["low"], top["high"]]
    else:
        headline = f"{counts['Star']} stars, {counts['Workhorse']} crowd-pleasers, {counts['Puzzle']} hidden gems, {counts['Dog']} to rethink — no clear money move"
        action = "Nothing to change this month."
        monthly, rng = None, None
    how = [
        "We looked at the last 30 days of Square sales and today's plate costs for every menu item.",
        "Popularity: an item is popular if it sells at least 70% of an even share (with N items in a group, that's 70% × 1/N of what the group sells). Margin: an item is high-margin if its price minus plate cost beats the group's volume-weighted average.",
        "Stars (popular, earn well): leave alone. Crowd-pleasers (popular, earn little): a small price rise. Hidden gems (earn well, few sold): promote them. Rethink (few sold, earn little): rework or drop.",
        "Price moves are on a 50¢ grid, at most +12%, and are picked assuming guests are a bit more price-sensitive than our best estimate — so the number is cautious.",
    ]
    if a30["small"]:
        how.append("Not placed because their group has fewer than 3 items to compare against: " + ", ".join(r["name"] for r in a30["small"]) + " (price response still covers them).")
    if a30["badCost"]:
        how.append("Left out because the plate cost looks wrong or incomplete: " + ", ".join(f"{b['name']} (cost {exact_money(b['cost'])})" for b in a30["badCost"]) + ". Fix the ingredient prices and they'll come back.")
    if shifted:
        how.append("Over 90 days some items sit in a different box: " + ", ".join(f"{r['name']} ({PLAIN[r['cls90']]} → {PLAIN[r['cls']]})" for r in shifted) + ".")
    inputs = [inp(r["name"], f"{PLAIN[r['cls']]}: {r['qty']:.0f} sold ({pct(r['mix'])}), ${r['price']:.2f} − ${r['cost']:.2f} = ${r['cm']:.2f} margin") for r in sorted(rows, key=lambda x: -x["qty"])]
    return insight(
        "menu",
        "Menu",
        headline=headline,
        action=action,
        monthly=monthly,
        range=rng,
        confidence=conf,
        how=how,
        inputs=inputs,
        chart={"type": "quadrant", "points": [{"label": r["name"], "x": round(r["mix"] / r["popCut"], 3), "y": round(r["cm"] - r["avgCm"], 2), "cls": r["cls"]} for r in rows]},
        details={"rows": [{k: r.get(k) for k in ("id", "name", "group", "qty", "qtyMonth", "price", "listPrice", "cost", "cm", "mix", "cls", "cls90", "action", "move", "elasticity", "eSource")} for r in rows], "counts": counts, "badCost": a30["badCost"], "window90Days": a90["openDays"]},
        opportunities=opps,
    )
