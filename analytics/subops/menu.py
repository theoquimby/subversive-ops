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
from .context import evidence, row, sure_line
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


def classify(rows: list[dict], key: str = "qty") -> list[dict]:
    """Adds mix, popular, highMargin and cls to each row ({qty, cm}). Pure function.
    `key` is what popularity is measured on (qty, or perDay for sold per open day on the menu)."""
    total = sum(r[key] for r in rows)
    n = len(rows)
    if total <= 0 or n == 0:
        return rows
    pop_cut = 0.7 / n
    avg_cm = sum(r["qty"] * r["cm"] for r in rows) / max(1e-9, sum(r["qty"] for r in rows))
    for r in rows:
        r["mix"] = r[key] / total
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
    """Popularity is judged like with like and per day on the menu:
    - against items in the same category (sandwiches vs sandwiches) when it has 3+ items, else the
      group (food or drinks) — a side isn't "unpopular" because mains outsell it;
    - as sold per open day *while it was on the menu* (first to last sale in the window), so a dish
      added three weeks ago, or a beer that was only on tap for half the month, isn't marked down
      for the days it wasn't there. Items on for under a week are too new to judge."""
    as_of = data["asOf"]
    since = add_days(as_of, -window)
    opm = open_days_per_month(data.get("days", []))
    open_dates = sorted(x["date"] for x in data.get("days", []) if x.get("open") and x["date"] >= since)
    n_open = len(open_dates)
    rows, bad_cost, new_items, gone = [], [], [], []
    for it in data.get("items", []):
        if it.get("kind") != "MENU":
            continue
        daily = {k: v for k, v in (it.get("daily") or {}).items() if k >= since and v[0] > 0}
        qty = sum(v[0] for v in daily.values())
        sales = sum(v[1] for v in daily.values())
        if qty <= 0:
            continue
        first, last = min(daily), max(daily)
        older = any(k < since and v[0] > 0 for k, v in (it.get("daily") or {}).items()) or any(k < since for k, v in (it.get("weekly") or {}).items() if v[0] > 0)
        start = since if older else first
        end = as_of if last >= add_days(as_of, -10) else last
        on_days = len([k for k in open_dates if start <= k <= end]) or 1
        if on_days < 6:
            new_items.append(it["name"])
            continue
        if end != as_of:
            gone.append(it["name"])
        p = sales / qty
        cost = it.get("unitCost")
        if cost is None or it.get("costIncomplete") or cost >= 0.9 * p:
            bad_cost.append({"id": it["id"], "name": it["name"], "cost": cost, "price": p})
            continue
        per_day = qty / on_days
        rows.append({"id": it["id"], "name": it["name"], "group": it.get("group") or "food", "category": it.get("category"), "qty": qty, "onDays": on_days, "perDay": per_day, "qtyMonth": per_day * opm, "price": p, "listPrice": it.get("price") or p, "cost": cost, "cm": p - cost})
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
        # Margin is judged within the group; popularity within the category when it's big enough.
        by_cat: dict[str, list[dict]] = {}
        for r in g:
            by_cat.setdefault((r.get("category") or "").strip().lower() or "_", []).append(r)
        classify(g, key="perDay")
        for cat, rs in by_cat.items():
            if cat != "_" and len(rs) >= 3 and len(rs) < len(g):
                classify_pop(rs, key="perDay")
                for r in rs:
                    r["popWithin"] = r.get("category")
    return {"rows": rows, "small": [{"id": r["id"], "name": r["name"], "group": r["group"]} for r in small], "badCost": bad_cost, "openDays": n_open, "groups": {k: [r["id"] for r in v] for k, v in groups.items()}, "newItems": new_items, "gone": gone}


def classify_pop(rows: list[dict], key: str = "qty") -> list[dict]:
    """Re-judge popularity within a smaller set (a category), keeping the margin call."""
    total = sum(r[key] for r in rows)
    n = len(rows)
    if total <= 0 or n == 0:
        return rows
    cut = 0.7 / n
    for r in rows:
        r["mix"] = r[key] / total
        r["popular"] = r["mix"] >= cut
        r["popCut"] = cut
        r["cls"] = {(True, True): "Star", (True, False): "Workhorse", (False, True): "Puzzle", (False, False): "Dog"}[(r["popular"], r["highMargin"])]
    return rows


def menu_evidence(r: dict, rows: list[dict], a: dict, e: dict | None) -> dict:
    within = r.get("popWithin")
    peers = [x for x in rows if (within and x.get("popWithin") == within) or (not within and x["group"] == r["group"])]
    peer_label = f"the {within}" if within else ("drinks" if r["group"] == "beverage" else "food")
    rows_ev = [
        row("Sold per open day on the menu", value=f"{r['perDay']:.1f}", note=f"{r['qty']:.0f} over {r['onDays']} open days"),
        row(f"Share of {peer_label} sold", value=pct(r["mix"]), strong=True),
        row("Popular from", value=pct(r["popCut"]), note=f"70% of an even share among {len(peers)} items"),
        row("Margin (price − plate cost)", value=f"${r['cm']:.2f}"),
        row("Average margin in its group", value=f"${r['avgCm']:.2f}"),
    ]
    steps = [f"We compare the {r['name']} with {peer_label} ({len(peers)} items), counting sales per open day while each was on the menu.", f"It's a {PLAIN[r['cls']].lower()}: {'popular' if r['popular'] else 'below the popular line'} and {'above' if r['highMargin'] else 'below'} the average margin."]
    if r.get("move") and r["move"].get("kind") == "reprice" and e:
        steps.append("The price move allows for guests buying a little less — " + ("measured from this item's own price changes, allowing for traffic and season." if e.get("source") == "measured" else "using how similar items reacted when their prices moved."))
    return evidence(verdict="real", summary=f"{r['name']}: {pct(r['mix'])} of {peer_label} sold per day on the menu (popular from {pct(r['popCut'])}), ${r['cm']:.2f} margin vs ${r['avgCm']:.2f} average.", rows=rows_ev, steps=steps,
                    excluded=([f"too new to judge: {', '.join(a.get('newItems', [])[:4])}"] if a.get("newItems") else []),
                    method="Like-with-like popularity per day on the menu, against margin after today's plate costs.",
                    sure=sure_line("medium", "it's 30 days of sales; a menu change or a busy event can shift an item between boxes — the 90-day view is in the tile."))


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
            peers = [x for x in rows if (x.get("popWithin") and x.get("popWithin") == r.get("popWithin")) or (not r.get("popWithin") and (x["group"] == r["group"] or len(a30["groups"]) == 1))]
            target = r["popCut"] * sum(x["perDay"] for x in peers)
            extra_month = max(0.0, target - r["perDay"]) * open_days_per_month(data.get("days", []))
            gain = extra_month * max(0.0, r["cm"] - r["avgCm"])  # each extra one mostly replaces an average-margin item
            r["move"] = {"kind": "promote", "gain": gain, "extra": extra_month}
            if gain > 15:
                opps.append(opportunity(f"menu.promote.{r['id']}", "menu.promote", "menu", f"Sell more {r['name']} → up to +{money(gain)}/month", f"Move the {r['name']} to the top of its section and have servers mention it; aim for {extra_month / 4.3:.0f} more a week.", gain, gain * 0.3, gain, 0.3,
                                        [f"It earns ${r['cm']:.2f} a plate vs ${r['avgCm']:.2f} on average but only {pct(r['mix'])} of items sold. If it reached the popularity cut-off ({pct(r['popCut'])}) and each extra sale replaced an average item, you'd keep the margin difference."],
                                        [inp("Margin", f"${r['cm']:.2f}"), inp("Average margin", f"${r['avgCm']:.2f}"), inp("Extra sold per month", f"{extra_month:.0f}")], subject=r["id"]))
        elif r["cls"] == "Dog":
            r["move"] = {"kind": "rework", "gain": 0.0}
    by_id = {r["id"]: r for r in rows}
    for o in opps:
        r = by_id.get(o["subject"])
        if r:
            o["evidence"] = menu_evidence(r, rows, a30, elastic.get(r["id"]))
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
        "Popularity is judged like with like — against items in the same category (sandwiches with sandwiches) when there are 3 or more, else food with food and drinks with drinks — and per open day while the item was on the menu, so a new dish or a beer that was only on tap for part of the month isn't marked down for days it wasn't there. An item is popular if it sells at least 70% of an even share (70% × 1/N). Margin: price minus plate cost against the group's average.",
        "Stars (popular, earn well): leave alone. Crowd-pleasers (popular, earn little): a small price rise. Hidden gems (earn well, few sold): promote them. Rethink (few sold, earn little): rework or drop.",
        "Price moves are on a 50¢ grid, at most +12%, and are picked assuming guests are a bit more price-sensitive than our best estimate — so the number is cautious.",
    ]
    if a30["small"]:
        how.append("Not placed because their group has fewer than 3 items to compare against: " + ", ".join(r["name"] for r in a30["small"]) + " (price response still covers them).")
    if a30["badCost"]:
        how.append("Left out because the plate cost looks wrong or incomplete: " + ", ".join(f"{b['name']} (cost {exact_money(b['cost'])})" for b in a30["badCost"]) + ". Fix the ingredient prices and they'll come back.")
    if a30.get("newItems"):
        how.append("Too new to judge (on the menu under a week): " + ", ".join(a30["newItems"][:6]) + ".")
    if a30.get("gone"):
        how.append("Judged only for the days they were on (they stopped selling partway through): " + ", ".join(a30["gone"][:6]) + ".")
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
        details={"rows": [{k: r.get(k) for k in ("id", "name", "group", "category", "qty", "onDays", "perDay", "popWithin", "qtyMonth", "price", "listPrice", "cost", "cm", "mix", "cls", "cls90", "action", "move", "elasticity", "eSource")} for r in rows], "counts": counts, "badCost": a30["badCost"], "window90Days": a90["openDays"]},
        opportunities=opps,
    )
