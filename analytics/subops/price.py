"""Price response: how much volume each item loses when its price goes up.

Method
- The *list* price per week is the most common daily average price (rounded to
  25¢), so one-off discounts and comps don't count as price changes.
- A price change is a list-price step of 2%+ that holds for 2+ weeks.
- Items with a change and 14+ open days either side get a log-log regression:
  log(qty) ~ log(price) + weekday + log(store orders) + trend (OLS, robust SEs).
  Store orders soak up traffic swings (events, weather, season).
- Every estimate is shrunk toward a category prior (normal–normal), so a noisy
  fit can't produce a crazy number; items with no change use the prior alone.
"""

from __future__ import annotations

import math
from collections import Counter

import numpy as np
import pandas as pd
import statsmodels.api as sm

from .common import confidence, exact_money, inp, insight, money, open_days_per_month, opportunity, shrink, story, weekday

# Typical own-price elasticities for full-service restaurant items (mean, sd).
# Food-away-from-home studies put the aggregate near −0.8; single items are more
# elastic than the category because guests switch within the menu.
PRIORS = {
    "main": (-0.9, 0.35),
    "side": (-0.7, 0.3),
    "snack": (-1.0, 0.4),
    "beer": (-0.8, 0.35),
    "drink": (-0.8, 0.35),
    "add-on": (-0.6, 0.3),
    "other": (-0.9, 0.4),
}


def prior_for(category: str, group: str | None = None) -> tuple[str, float, float]:
    c = (category or "").lower()
    for key, words in [("main", ["main", "entree", "sandwich", "burger"]), ("side", ["side"]), ("snack", ["snack", "app", "starter", "share"]), ("beer", ["beer", "draft", "tap"]), ("drink", ["drink", "cocktail", "wine", "bev"]), ("add-on", ["add", "modifier", "extra"])]:
        if any(w in c for w in words):
            return (key, *PRIORS[key])
    if group == "beverage":
        return ("drink", *PRIORS["drink"])
    return ("other", *PRIORS["other"])


# Typical cost as a share of price when plate costs aren't set up yet (own beer poured is cheap; food ~30%).
TYPICAL_COST = {"beer": 0.22, "drink": 0.24, "main": 0.32, "side": 0.28, "snack": 0.28, "add-on": 0.25, "other": 0.30}


def assumed_cost(item: dict, price: float) -> float:
    cat = prior_for(item.get("category", ""), item.get("group"))[0]
    return price * TYPICAL_COST.get(cat, 0.3)


def fit_weekly(item: dict, traffic_week: dict[str, float]) -> dict | None:
    """Elasticity from weekly sales over the whole range (years of history): log(qty) ~ log(list price)
    + log(store orders that week) + trend + quarter. Weekly totals are far less noisy than days."""
    weekly = item.get("weekly") or {}
    rows = sorted((k, v[0], v[1]) for k, v in weekly.items() if v[0] and v[0] > 0 and v[1] > 0)
    if len(rows) < 26:
        return None
    df = pd.DataFrame(rows, columns=["week", "qty", "sales"])
    df["price"] = df["sales"] / df["qty"]
    df["list"] = (df["price"] / 0.25).round() * 0.25
    df.index = pd.to_datetime(df["week"])
    changes = price_changes(df["list"], min_step=0.04, min_days=4)
    if not changes:
        return {"changes": [], "fit": None}
    df["lq"] = np.log(df["qty"])
    df["lp"] = np.log(df["list"])
    df["t"] = (df.index - df.index[0]).days / 365.25
    X = pd.get_dummies(df.index.quarter, prefix="q", drop_first=True).astype(float)
    X.index = df.index
    X["lp"] = df["lp"]
    X["t"] = df["t"]
    tr = np.array([traffic_week.get(k, np.nan) for k in df["week"]], dtype=float)
    if np.isfinite(tr).mean() > 0.8 and np.nanmin(tr) > 0:
        X["ltraffic"] = np.log(np.where(np.isfinite(tr), tr, np.nanmedian(tr)))
    X = sm.add_constant(X, has_constant="add")
    try:
        m = sm.OLS(df["lq"], X).fit(cov_type="HC1")
        return {"changes": changes, "fit": {"raw": float(m.params["lp"]), "se": float(m.bse["lp"]), "n": int(len(df)), "weekly": True}}
    except Exception:  # noqa: BLE001
        return {"changes": changes, "fit": None}


def list_prices(daily: pd.DataFrame) -> pd.Series:
    """Weekly modal price (25¢ grid), forward-filled to each day."""
    df = daily.copy()
    df["week"] = df.index.to_period("W-SUN")
    df["p"] = (df["price"] / 0.25).round() * 0.25
    modal = df.groupby("week")["p"].agg(lambda s: Counter(s).most_common(1)[0][0])
    return df["week"].map(modal).astype(float)


def price_changes(lp: pd.Series, min_step: float = 0.02, min_days: int = 10) -> list[dict]:
    """Sustained list-price steps."""
    out = []
    vals = lp.values
    idx = lp.index
    i = 1
    while i < len(vals):
        if vals[i - 1] > 0 and abs(vals[i] / vals[i - 1] - 1) >= min_step:
            # how long does the new price hold?
            j = i
            while j < len(vals) and abs(vals[j] - vals[i]) < 0.01:
                j += 1
            if j - i >= min_days:
                out.append({"date": idx[i].date().isoformat(), "from": float(vals[i - 1]), "to": float(vals[i])})
            i = j
        else:
            i += 1
    return out


def fit_item(item: dict, traffic: dict[str, float], traffic_week: dict[str, float] | None = None) -> dict:
    """Elasticity for one item: measured (shrunk) when its price changed, else the category prior."""
    cat, pm, psd = prior_for(item.get("category", ""), item.get("group"))
    res = {"id": item["id"], "name": item["name"], "category": cat, "prior": pm, "priorSd": psd, "elasticity": pm, "sd": psd, "source": "typical", "changes": [], "fit": None}
    wk = fit_weekly(item, traffic_week or {}) if item.get("weekly") else None
    if wk is not None:
        res["changes"] = [{**c, "date": c["date"]} for c in wk["changes"]]
        if wk["fit"]:
            mean, sd = shrink(wk["fit"]["raw"], wk["fit"]["se"], pm, psd)
            res.update({"elasticity": float(np.clip(mean, -3.0, -0.05)), "sd": sd, "source": "measured", "fit": wk["fit"]})
        return res
    rows = [(k, v[0], v[1]) for k, v in (item.get("daily") or {}).items() if v[0] and v[0] > 0]
    if len(rows) < 14:
        return res
    df = pd.DataFrame(rows, columns=["date", "qty", "sales"]).assign(date=lambda x: pd.to_datetime(x["date"])).set_index("date").sort_index()
    df["price"] = df["sales"] / df["qty"]
    df["list"] = list_prices(df)
    changes = price_changes(df["list"])
    res["changes"] = changes
    if not changes:
        return res
    first, last = df.index[0], df.index[-1]
    ok = [c for c in changes if (pd.Timestamp(c["date"]) - first).days >= 14 and (last - pd.Timestamp(c["date"])).days >= 14]
    if not ok:
        return res
    df["lq"] = np.log(df["qty"])
    df["lp"] = np.log(df["list"])
    df["wd"] = [weekday(x.date().isoformat()) for x in df.index]
    df["t"] = (df.index - first).days / 30.0
    X = pd.get_dummies(df["wd"], prefix="wd", drop_first=True).astype(float)
    X["lp"] = df["lp"]
    X["t"] = df["t"]
    tr = np.array([traffic.get(x.date().isoformat(), np.nan) for x in df.index], dtype=float)
    if np.isfinite(tr).mean() > 0.8 and np.nanmin(tr) > 0:
        X["ltraffic"] = np.log(np.where(np.isfinite(tr), tr, np.nanmedian(tr)))
    X = sm.add_constant(X, has_constant="add")
    try:
        m = sm.OLS(df["lq"], X).fit(cov_type="HC1")
        est, se = float(m.params["lp"]), float(m.bse["lp"])
    except Exception:  # singular design etc.
        return res
    mean, sd = shrink(est, se, pm, psd)
    mean = float(np.clip(mean, -3.0, -0.05))
    res.update({"elasticity": mean, "sd": sd, "source": "measured", "fit": {"raw": est, "se": se, "n": int(len(df))}})
    return res


def what_if(price: float, cost: float | None, qty_month: float, elasticity: float, delta: float) -> dict:
    """Monthly profit change from moving the price by `delta`, constant elasticity."""
    p1 = price + delta
    if price <= 0 or p1 <= 0:
        return {"qty": qty_month, "profit": 0.0, "revenue": 0.0}
    q1 = qty_month * (p1 / price) ** elasticity
    c = cost or 0.0
    return {"qty": q1, "profit": q1 * (p1 - c) - qty_month * (price - c), "revenue": q1 * p1 - qty_month * price}


def run(data: dict) -> dict:
    for i in data.get("items", []):
        if not (i.get("price") or 0) > 0:
            # No list price from the catalog: use what it sold for over the last few weeks.
            src = sorted((i.get("daily") or {}).items())[-28:] or sorted((i.get("weekly") or {}).items())[-4:]
            q = sum(v[0] for _, v in src)
            if q > 0:
                i["price"] = round(sum(v[1] for _, v in src) / q * 4) / 4
    items = [i for i in data.get("items", []) if i.get("kind") in ("MENU", "MODIFIER") and (i.get("price") or 0) > 0]
    traffic = {x["date"]: x.get("orders") for x in data.get("days", []) if x.get("orders")}
    traffic_week: dict[str, float] = {}
    for dt, o in traffic.items():
        wk = (pd.Timestamp(dt) - pd.Timedelta(days=pd.Timestamp(dt).weekday())).date().isoformat()
        traffic_week[wk] = traffic_week.get(wk, 0.0) + float(o)
    n_days = len([x for x in data.get("days", []) if x.get("open")])
    if not items:
        return insight("price", "Prices", status="none", headline="No priced menu items with sales yet.", action="Link Square items to recipes on Sales → Menu from Square.", how=["Needs menu items with a price and some sales."])
    fits, suspect = [], []
    opm = open_days_per_month(data.get("days", []))
    for it in items:
        f = fit_item(it, traffic, traffic_week)
        daily = it.get("daily") or {}
        if daily:
            cutoff = sorted(traffic)[-28] if len(traffic) >= 28 else ""
            qty28 = sum(v[0] for k, v in daily.items() if k >= cutoff)
            open28 = max(1, len([k for k in traffic if k >= cutoff]))
            qty_month = qty28 / open28 * opm
        else:
            wks = sorted((it.get("weekly") or {}).items())[-4:]
            qty_month = sum(v[0] for _, v in wks) / max(1, len(wks)) * 4.33
        cost = it.get("unitCost")
        f["costAssumed"] = False
        if cost is None and it.get("linked") is False:
            cost = assumed_cost(it, it["price"])
            f["costAssumed"] = True
        elif cost is not None and (it.get("costIncomplete") or cost >= 0.9 * it["price"]):
            suspect.append(it["name"])
            continue  # a wrong plate cost (e.g. a typo'd ingredient price) would make any price rise look great
        w = what_if(it["price"], cost, qty_month, f["elasticity"], 1.0)
        lo = what_if(it["price"], cost, qty_month, f["elasticity"] - 1.28 * f["sd"], 1.0)
        hi = what_if(it["price"], cost, qty_month, min(-0.01, f["elasticity"] + 1.28 * f["sd"]), 1.0)
        fits.append({**f, "price": it["price"], "unitCost": cost, "qtyMonth": qty_month, "plusOne": w["profit"], "plusOneLow": lo["profit"], "plusOneHigh": hi["profit"], "qtyLossPct": 1 - w["qty"] / qty_month if qty_month else 0})
    # Lead with the move that pays even if guests are more price-sensitive than we think.
    if not fits:
        return insight("price", "Prices", status="thin", headline="Plate costs need fixing before prices can be tested.", action="Check ingredient prices for: " + ", ".join(suspect), how=[])
    fits.sort(key=lambda f: (-(f["plusOneLow"] > 0), -f["plusOneLow"], -f["plusOne"]))
    measured = [f for f in fits if f["source"] == "measured"]
    best = fits[0]
    weeks = n_days
    if measured:
        conf = confidence(weeks, 0.1 if len(measured) < len(fits) / 2 else 0.0)
    else:
        conf = confidence(weeks, 0.3)
        conf["note"] = f"{conf['note'].split(' — ')[0].replace('Based on ', '')}, no price changes yet — rough"
    name = best["name"]
    sens = lambda e: "barely notice" if e > -0.5 else "notice a little" if e > -1.0 else "notice"
    headline = f"+$1 on the {name} → about {money(best['plusOne'])} a month more profit (likely {money(best['plusOneLow'])}–{money(best['plusOneHigh'])})" if best["plusOne"] > 0 else "No single $1 price rise clearly pays right now"
    action = f"Raise the {name} to {exact_money(best['price'] + 1)} and leave it for 3 weeks — we'll measure what it really did." if best["plusOne"] > 0 else "Prices look about right."
    assumed = [f for f in fits if f.get("costAssumed")]
    how = [
        "For each item we asked: if the price goes up $1, how many fewer would you sell, and what's left after its cost?",
        (f"{len(measured)} of these items have had a real price change in your Square history, so we measured how your guests reacted — week by week, allowing for how busy the place was and the time of year — and blended that with typical figures so one noisy stretch can't swing it." if measured else "You haven't changed these prices in the history we have (one-off discounts don't count), so we use how guests typically react for that kind of item. Change one price and leave it for 3 weeks, and this switches to your own guests."),
        "The likely range allows for guests being more (or less) price-sensitive than our best guess. The low end is what we'd plan on.",
    ]
    if assumed:
        how.append(f"Plate costs aren't set up for {len(assumed)} of these items yet, so we used a typical cost for that kind of item (beer about 22% of the price, food about 30%). Link them to recipes for your real numbers.")
    if suspect:
        how.append("Left out because the plate cost looks wrong (90%+ of the price, or incomplete): " + ", ".join(suspect) + ".")
    inputs = [inp(f["name"], f"{exact_money(f['price'])}, ~{f['qtyMonth']:.0f} a month, guests {sens(f['elasticity'])} a price rise ({'measured' if f['source'] == 'measured' else 'typical'})") for f in fits[:12]]
    opps = []
    for f in sorted(fits, key=lambda f: -f["plusOneLow"])[:3]:
        if f["plusOne"] > 40 and f["plusOneLow"] > 0:
            loss = f["qtyLossPct"]
            visual = {"type": "compare", "unit": "money", "rows": [{"label": f"Profit a month at {exact_money(f['price'])}", "value": round(f["qtyMonth"] * (f["price"] - (f["unitCost"] or 0)))}, {"label": f"At {exact_money(f['price'] + 1)}", "value": round(f["qtyMonth"] * (f["price"] - (f["unitCost"] or 0)) + f["plusOne"]), "tone": "good"}]}
            opps.append(opportunity(
                f"price.plus1.{f['id']}", "price.test", "price",
                f"Try $1 more on the {f['name']}",
                f"Raise the {f['name']} to {exact_money(f['price'] + 1)} in Square for 3 weeks and watch how many sell.",
                f["plusOne"], f["plusOneLow"], f["plusOneHigh"], conf["score"] * (1 if f["source"] == "measured" else 0.7) * (0.8 if f.get("costAssumed") else 1),
                how[:2], [inp("Price now", exact_money(f["price"])), inp("Cost" + (" (typical)" if f.get("costAssumed") else ""), exact_money(f["unitCost"])), inp("Sold per month", f"{f['qtyMonth']:.0f}"), inp("How guests react", f"{sens(f['elasticity'])} ({'measured' if f['source'] == 'measured' else 'typical'})")],
                href="/insights#lab-price", subject=f["id"], area="menu", effort="easy", vector="earn",
                story=story(
                    f"The {f['name']} sells about {f['qtyMonth']:.0f} a month at {exact_money(f['price'])}.",
                    (f"When its price changed before, your guests {sens(f['elasticity'])} it." if f["source"] == "measured" else f"Guests usually {sens(f['elasticity'])} $1 on an item like this.") + f" We expect about {loss * 100:.0f}% fewer sold — and each one still earns $1 more.",
                    f"Change it to {exact_money(f['price'] + 1)} in Square and leave it for 3 weeks. We'll show you what it really did.",
                    f"About {money(f['plusOne'])} a month (we'd plan on {money(f['plusOneLow'])}).",
                ),
                visual=visual,
            ))
    return insight(
        "price",
        "Prices",
        headline=headline,
        action=action,
        monthly=best["plusOne"] if best["plusOne"] > 0 else None,
        range=[best["plusOneLow"], best["plusOneHigh"]],
        confidence=conf,
        how=how,
        inputs=inputs,
        chart={"type": "bars", "unit": "money", "rows": [{"label": f["name"], "value": round(f["plusOne"], 0), "low": round(f["plusOneLow"], 0), "high": round(f["plusOneHigh"], 0)} for f in sorted(fits, key=lambda f: -f["plusOneLow"])[:6]]},
        details={"items": [{k: f.get(k) for k in ("id", "name", "price", "unitCost", "qtyMonth", "elasticity", "sd", "source", "changes", "plusOne", "plusOneLow", "plusOneHigh", "costAssumed")} for f in fits]},
        opportunities=opps,
    )


def elasticity_map(result: dict) -> dict[str, dict]:
    return {x["id"]: x for x in (result.get("details") or {}).get("items", [])}
