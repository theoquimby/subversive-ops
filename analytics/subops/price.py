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

from .context import evidence, row, sure_line
from .common import add_days, confidence, exact_money, inp, insight, money, open_days_per_month, opportunity, shrink, story, weekday

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


POOL_BIAS_SD = 0.3

# Typical cost as a share of price when plate costs aren't set up yet (own beer poured is cheap; food ~30%).
TYPICAL_COST = {"beer": 0.22, "drink": 0.24, "main": 0.32, "side": 0.28, "snack": 0.28, "add-on": 0.25, "other": 0.30}


def assumed_cost(item: dict, price: float) -> float:
    cat = prior_for(item.get("category", ""), item.get("group"))[0]
    return price * TYPICAL_COST.get(cat, 0.3)


def fit_weekly(item: dict, traffic_week: dict[str, float]) -> dict | None:
    """Price response from weekly sales over the whole range (years of history):
    log(qty) ~ log(list price) + log(store orders that week) + time of year (smooth yearly waves)
    + trend. Store orders soak up how busy each week was; the yearly waves soak up the season
    (lager in July vs January), so a price change that happened to land in autumn isn't blamed
    for autumn. Weeks the item barely sold (off the menu, keg out part of the week) are left out."""
    weekly = item.get("weekly") or {}
    rows = sorted((k, v[0], v[1]) for k, v in weekly.items() if v[0] and v[0] > 0 and v[1] > 0)
    if len(rows) < 26:
        return None
    df = pd.DataFrame(rows, columns=["week", "qty", "sales"])
    med = float(df["qty"].median())
    low = df["qty"] < 0.2 * med
    dropped = int(low.sum())
    df = df[~low].reset_index(drop=True)
    if len(df) < 26:
        return None
    df["price"] = df["sales"] / df["qty"]
    df["list"] = (df["price"] / 0.25).round() * 0.25
    df.index = pd.to_datetime(df["week"])
    changes = price_changes(df["list"], min_step=0.04, min_days=4)
    if not changes:
        return {"changes": [], "fit": None, "dropped": dropped}
    df["lq"] = np.log(df["qty"])
    df["lp"] = np.log(df["list"])
    df["t"] = (df.index - df.index[0]).days / 365.25
    doy = df.index.day_of_year.values / 365.25
    X = pd.DataFrame(index=df.index)
    span_years = float(df["t"].iloc[-1])
    harmonics = 2 if span_years >= 1.5 else 1 if span_years >= 0.75 else 0
    for k in range(1, harmonics + 1):
        X[f"s{k}"] = np.sin(2 * np.pi * k * doy)
        X[f"c{k}"] = np.cos(2 * np.pi * k * doy)
    if harmonics == 0:
        q = pd.get_dummies(df.index.quarter, prefix="q", drop_first=True).astype(float)
        q.index = df.index
        X = pd.concat([X, q], axis=1)
    X["lp"] = df["lp"]
    X["t"] = df["t"]
    tr = np.array([traffic_week.get(k, np.nan) for k in df["week"]], dtype=float)
    traffic = bool(np.isfinite(tr).mean() > 0.8 and np.nanmin(tr) > 0)
    if traffic:
        X["ltraffic"] = np.log(np.where(np.isfinite(tr), tr, np.nanmedian(tr)))
    X = sm.add_constant(X, has_constant="add")
    try:
        m = sm.OLS(df["lq"], X).fit(cov_type="HC1")
        return {"changes": changes, "fit": {"raw": float(m.params["lp"]), "se": float(m.bse["lp"]), "n": int(len(df)), "weekly": True, "traffic": traffic, "season": harmonics > 0, "dropped": dropped}, "dropped": dropped}
    except Exception:  # noqa: BLE001
        return {"changes": changes, "fit": None, "dropped": dropped}


def pool(fits: list[dict]) -> dict[str, dict]:
    """Hierarchical shrinkage: items of the same kind (beer, mains, …) share a typical response.
    The kind's mean and how much its items really differ (between-item spread, DerSimonian–Laird)
    are estimated from the items that had price changes, then pulled toward the published typical
    figure; each measured item is then pulled toward its kind's mean by how noisy its own estimate is.
    Returns kind → {mean, sd, tau, n}."""
    out: dict[str, dict] = {}
    by: dict[str, list[dict]] = {}
    for f in fits:
        by.setdefault(f["category"], []).append(f)
    for cat, fs in by.items():
        pm, psd = PRIORS.get(cat, PRIORS["other"])
        meas = [f for f in fs if f.get("fit") and f["fit"].get("se", 0) > 0 and math.isfinite(f["fit"]["raw"])]
        tau = psd * 0.6  # how much single items typically differ from their kind
        mean, sd = pm, psd
        if len(meas) >= 2:
            y = np.array([np.clip(f["fit"]["raw"], -4, 1) for f in meas])
            v = np.array([f["fit"]["se"] ** 2 for f in meas])
            w = 1 / v
            mu_fe = float((w * y).sum() / w.sum())
            Q = float((w * (y - mu_fe) ** 2).sum())
            c = float(w.sum() - (w**2).sum() / w.sum())
            tau2 = max(0.0, (Q - (len(meas) - 1)) / c) if c > 0 else 0.0
            tau = float(np.clip(math.sqrt(tau2), 0.15, 1.0))
            ws = 1 / (v + tau**2)
            mu = float((ws * y).sum() / ws.sum())
            # Prices usually go up when an item is doing well, so before/after histories make guests look
            # less price-sensitive than they are. However many items agree, the kind's mean keeps at least
            # this much doubt and so stays anchored to the published figure.
            mu_se = math.sqrt(1 / ws.sum() + POOL_BIAS_SD**2)
            mean, sd = shrink(mu, mu_se, pm, psd)
        elif len(meas) == 1:
            f = meas[0]
            mean, sd = shrink(float(np.clip(f["fit"]["raw"], -4, 1)), math.sqrt(f["fit"]["se"] ** 2 + tau**2), pm, psd)
        out[cat] = {"mean": float(mean), "sd": float(sd), "tau": float(tau), "n": len(meas)}
    return out


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
    raw = [(it, fit_item(it, traffic, traffic_week)) for it in items]
    # Hierarchical: each item's measured response is pulled toward what similar items showed,
    # and items that never changed price borrow from similar items that did.
    pooled = pool([f for _, f in raw])
    for it, f in raw:
        g = pooled.get(f["category"])
        if g:
            prior_sd = math.sqrt(g["tau"] ** 2 + g["sd"] ** 2)
            f["pooled"] = {"mean": g["mean"], "sd": prior_sd, "n": g["n"]}
            if f.get("fit") and f["fit"].get("se", 0) > 0:
                mean, sd = shrink(float(np.clip(f["fit"]["raw"], -4, 1)), f["fit"]["se"], g["mean"], prior_sd)
                f.update({"elasticity": float(np.clip(mean, -3.0, -0.05)), "sd": sd, "source": "measured", "basis": "own"})
            else:
                f.update({"elasticity": float(np.clip(g["mean"], -3.0, -0.05)), "sd": prior_sd, "basis": "similar" if g["n"] else "typical"})
    recent_cut = sorted(traffic)[-28] if len(traffic) >= 28 else ""
    for it, f in raw:
        daily = it.get("daily") or {}
        as_of = data.get("asOf") or (max(traffic) if traffic else "")
        sold_lately = any(k >= recent_cut and v[0] > 0 for k, v in daily.items()) if "daily" in it else any(k >= add_days(as_of, -35) and v[0] > 0 for k, v in (it.get("weekly") or {}).items())
        if as_of and not sold_lately:
            continue  # not sold in the last four weeks: off the menu (or its Square button now sells something else)
        if daily:
            cutoff = sorted(traffic)[-28] if len(traffic) >= 28 else ""
            qty28 = sum(v[0] for k, v in daily.items() if k >= cutoff)
            open28 = max(1, len([k for k in traffic if k >= cutoff]))
            qty_month = qty28 / open28 * opm
            orders28 = sum(float(v or 0) for k, v in traffic.items() if k >= cutoff)
            f["per100"] = qty28 / orders28 * 100 if orders28 else None
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
            ev = test_evidence(f, opm)
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
            opps[-1]["evidence"] = ev
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
        details={"items": [{k: f.get(k) for k in ("id", "name", "price", "unitCost", "qtyMonth", "elasticity", "sd", "source", "basis", "changes", "plusOne", "plusOneLow", "plusOneHigh", "costAssumed", "per100")} for f in fits]},
        evidence=opps[0]["evidence"] if opps else None,
        opportunities=opps,
    )


def _when(iso_date: str) -> str:
    x = pd.Timestamp(iso_date)
    return f"{x.strftime('%b')} {x.year}"


def test_evidence(f: dict, opm: float) -> dict:
    """Why we think $1 more would pay, in the owner's words, with every number behind it."""
    p, e, sd = f["price"], f["elasticity"], f["sd"]
    pct_up = 1 / p
    mid = (1 + pct_up) ** e - 1
    lo_q, hi_q = (1 + pct_up) ** (e - 1.28 * sd) - 1, (1 + pct_up) ** min(-0.01, e + 1.28 * sd) - 1
    short = f["name"].split(" · ")[0].split(" | ")[0]
    own = f.get("basis") == "own" or (f.get("source") == "measured" and not f.get("basis"))
    fit = f.get("fit") or {}
    changes = f.get("changes") or []
    rows = [
        row("Price now", value=exact_money(p) if abs(p - round(p)) < 0.005 else f"${p:.2f}"),
        row("Sold a month (recent weeks)", value=f"{f['qtyMonth']:.0f}"),
    ]
    if f.get("per100") is not None:
        rows.append(row("Sold per 100 orders (recent weeks)", value=f"{f['per100']:.2f}"))
    if changes:
        rows.append(row("Its own price changes in your history", value="; ".join(f"${c['from']:.2f} → ${c['to']:.2f} ({_when(c['date'])})" for c in changes[-3:])))
    if own:
        rows.append(row("What its own changes showed, after traffic and season", value=f"each 10% on the price cost about {abs(fit.get('raw', e)) * 10:.0f}% of its sales per guest"))
    pooled = f.get("pooled") or {}
    if pooled:
        kind_words = {"beer": "Other beers", "drink": "Other drinks", "main": "Other mains", "side": "Other sides", "snack": "Other snacks", "add-on": "Other add-ons"}.get(f["category"], "Other items on your menu")
        rows.append(row(f"{kind_words} typically", value=f"each 10% costs about {abs(pooled['mean']) * 10:.0f}% of sales" + (f" (from {plural_items(pooled['n'])} with price changes)" if pooled.get("n") else " (published figures for this kind of item)")))
    rows.append(row("What we expect from +$1", value=f"{abs(mid) * 100:.0f}% fewer sold (likely {abs(hi_q) * 100:.0f}–{abs(lo_q) * 100:.0f}%)", strong=True))
    rows.append(row("Profit a month from +$1", value=f"+{money(f['plusOne'])} (we'd plan on {money(f['plusOneLow'])})", strong=True))
    steps = []
    if own:
        steps.append(f"The {short}'s price has changed before. We compared week-by-week sales with its price, allowing for how many orders came in each week and the time of year (so a price change that landed in a quiet season isn't blamed for the season). Weeks it barely sold — off the menu, keg out — are left out.")
        steps.append("One item's history is noisy, so its own result is blended with what similar items on your menu showed; the noisier its own result, the more it leans on the others.")
    else:
        steps.append(f"The {short}'s price hasn't changed in the history we have, so we use what similar items on your menu showed when their prices moved" + (" — or, without those, published figures for this kind of item." if not pooled.get("n") else "."))
    steps.append(f"At {exact_money(p) if abs(p - round(p)) < 0.005 else f'${p:.2f}'}, $1 is a {pct_up * 100:.0f}% rise. We expect about {abs(mid) * 100:.0f}% fewer sold, and each one still earns $1 more{' after a typical cost for this kind of item' if f.get('costAssumed') else ''}.")
    steps.append("The low end of the range assumes guests are more price-sensitive than our best guess — that's the number to plan on.")
    excluded = []
    if fit.get("dropped"):
        excluded.append(f"{fit['dropped']} week{'s' if fit['dropped'] != 1 else ''} it barely sold (off the menu or out of stock)")
    level = "high" if own and fit.get("n", 0) >= 52 else "medium" if own or pooled.get("n") else "low"
    why = (f"its own price changes and {fit.get('n', 0)} weeks of sales point the same way, and even the cautious end pays." if level == "high" else
           "the cautious end of the range still pays, but the guess leans partly on similar items." if level == "medium" else
           "this item has never changed price, so this is how similar items behave — try it and we'll measure the real answer.")
    return evidence(verdict="real", summary=f"Even if guests are more price-sensitive than we think, $1 more on the {short} keeps about {money(f['plusOneLow'])} a month.", rows=rows, steps=steps, excluded=excluded,
                    method="Sales each week against its price, allowing for how busy each week was and the time of year, blended with similar items.", sure=sure_line(level, why),
                    effect={"mid": mid, "low": lo_q, "high": hi_q, "label": f"Change in {short} sold from +$1"})


def plural_items(n: int) -> str:
    return f"{n} item{'s' if n != 1 else ''}"


def elasticity_map(result: dict) -> dict[str, dict]:
    return {x["id"]: x for x in (result.get("details") or {}).get("items", [])}
