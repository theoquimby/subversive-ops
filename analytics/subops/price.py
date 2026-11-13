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

from .common import confidence, exact_money, inp, insight, money, open_days_per_month, opportunity, shrink, weekday

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


def fit_item(item: dict, traffic: dict[str, float]) -> dict:
    """Elasticity for one item: measured (shrunk) when its price changed, else the category prior."""
    cat, pm, psd = prior_for(item.get("category", ""), item.get("group"))
    rows = [(k, v[0], v[1]) for k, v in (item.get("daily") or {}).items() if v[0] and v[0] > 0]
    res = {"id": item["id"], "name": item["name"], "category": cat, "prior": pm, "priorSd": psd, "elasticity": pm, "sd": psd, "source": "typical", "changes": [], "fit": None}
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
    items = [i for i in data.get("items", []) if i.get("kind") in ("MENU", "MODIFIER") and (i.get("price") or 0) > 0]
    traffic = {x["date"]: x.get("orders") for x in data.get("days", []) if x.get("orders")}
    n_days = len([x for x in data.get("days", []) if x.get("open")])
    if not items:
        return insight("price", "Price response", status="none", headline="No priced menu items with sales yet.", action="Link Square items to recipes on Sales → Menu from Square.", how=["Needs menu items with a price and some sales."])
    fits = []
    opm = open_days_per_month(data.get("days", []))
    for it in items:
        f = fit_item(it, traffic)
        recent = sorted((it.get("daily") or {}).items())[-28:]
        qty28 = sum(v[0] for _, v in recent)
        open28 = max(1, len(recent))
        qty_month = qty28 / open28 * opm
        cost = it.get("unitCost")
        w = what_if(it["price"], cost, qty_month, f["elasticity"], 1.0)
        lo = what_if(it["price"], cost, qty_month, f["elasticity"] - 1.28 * f["sd"], 1.0)
        hi = what_if(it["price"], cost, qty_month, min(-0.01, f["elasticity"] + 1.28 * f["sd"]), 1.0)
        fits.append({**f, "price": it["price"], "unitCost": cost, "qtyMonth": qty_month, "plusOne": w["profit"], "plusOneLow": lo["profit"], "plusOneHigh": hi["profit"], "qtyLossPct": 1 - w["qty"] / qty_month if qty_month else 0})
    # Lead with the move that pays even if guests are more price-sensitive than we think.
    fits.sort(key=lambda f: (-(f["plusOneLow"] > 0), -f["plusOne"]))
    measured = [f for f in fits if f["source"] == "measured"]
    best = fits[0]
    weeks = n_days
    if measured:
        conf = confidence(weeks, 0.1 if len(measured) < len(fits) / 2 else 0.0)
    else:
        conf = confidence(weeks, 0.3)
        conf["note"] = f"{conf['note'].split(' — ')[0].replace('Based on ', '')}, no price changes yet — rough"
    name = best["name"]
    headline = f"+$1 on the {name} → about {money(best['plusOne'])}/month more profit (likely {money(best['plusOneLow'])} to {money(best['plusOneHigh'])})"
    action = f"Test +$1 on the {name} for 3 weeks; we'll measure what it really did." if best["plusOne"] > 0 else "Prices look about right — no +$1 move clearly pays."
    how = [
        "For each item we asked: if the price goes up, how many fewer do you sell? That's the price response (economists call it elasticity: −0.8 means +10% price → about 8% fewer sold).",
        (f"{len(measured)} item(s) had a real price change in your Square history, so we measured them with a regression of daily quantity on price, controlling for weekday, store traffic (order count) and trend, then blended the result with typical figures so one noisy month can't swing it." if measured else "You haven't changed a menu price in the history we have (one-off discounts don't count), so we use typical figures for restaurant items in each category — mains about −0.9, sides −0.7, beer −0.8. Change one price and leave it for 3+ weeks, and this switches to your own guests' behaviour."),
        "Then: new volume = today's volume × (new price ÷ old price)^elasticity, and profit = volume × (price − plate cost). The range uses the uncertainty in the elasticity (80% band).",
    ]
    inputs = [inp(f["name"], f"{exact_money(f['price'])}, plate {exact_money(f['unitCost'])}, ~{f['qtyMonth']:.0f}/month, elasticity {f['elasticity']:.2f} ({f['source']})") for f in fits]
    opps = []
    for f in fits[:3]:
        if f["plusOne"] > 25 and f["plusOneLow"] > 0:
            opps.append(opportunity(f"price.plus1.{f['id']}", "price.test", "price", f"+$1 on the {f['name']} → ≈ {money(f['plusOne'])}/month", f"Raise the {f['name']} to {exact_money(f['price'] + 1)} for 3 weeks and watch volume.", f["plusOne"], f["plusOneLow"], f["plusOneHigh"], conf["score"] * (1 if f["source"] == "measured" else 0.7), how[:1], [inp("Price now", exact_money(f["price"])), inp("Plate cost", exact_money(f["unitCost"])), inp("Sold per month", f"{f['qtyMonth']:.0f}"), inp("Elasticity", f"{f['elasticity']:.2f} ({f['source']})")], subject=f["id"]))
    return insight(
        "price",
        "Price response",
        headline=headline,
        action=action,
        monthly=best["plusOne"] if best["plusOne"] > 0 else None,
        range=[best["plusOneLow"], best["plusOneHigh"]],
        confidence=conf,
        how=how,
        inputs=inputs,
        chart={"type": "bars", "unit": "money", "rows": [{"label": f["name"], "value": round(f["plusOne"], 0), "low": round(f["plusOneLow"], 0), "high": round(f["plusOneHigh"], 0)} for f in fits[:6]]},
        details={"items": [{k: f[k] for k in ("id", "name", "price", "unitCost", "qtyMonth", "elasticity", "sd", "source", "changes", "plusOne", "plusOneLow", "plusOneHigh")} for f in fits]},
        opportunities=opps,
    )


def elasticity_map(result: dict) -> dict[str, dict]:
    return {x["id"]: x for x in (result.get("details") or {}).get("items", [])}
