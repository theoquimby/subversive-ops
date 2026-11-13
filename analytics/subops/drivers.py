"""Profit drivers and break-even.

A month is the last 28 days scaled to 30.4. Profit before fixed costs =
sales − cost of goods − labor − waste. Each lever is priced in $/month:

- +1% on prices: revenue and volume move together through the sales-weighted
  price response (so it's less than 1% of sales);
- −1 labor hour a day: the average loaded hourly labor cost × open days;
- −10% waste: a tenth of logged waste at cost;
- +5% guests: 5% more sales at today's food cost, labor unchanged.

Break-even: labor is split into a fixed part and a part that rises with sales
by regressing daily labor on daily sales (OLS). Break-even monthly sales =
(fixed costs + fixed labor) ÷ (1 − food cost % − waste % − variable labor %).
"""

from __future__ import annotations

import numpy as np
import statsmodels.api as sm

from .common import DAYS_PER_MONTH, add_days, confidence, inp, insight, money, open_days_per_month, pct


def lever_values(m: dict, elasticity: float) -> list[dict]:
    """Pure: $/month for each lever from monthly totals {sales, cogs, labor, waste, laborHours, openDays}."""
    s, c, lab, w = m["sales"], m["cogs"], m["labor"], m["waste"]
    rate = lab / m["laborHours"] if m["laborHours"] else 0.0
    q = 1.01**elasticity
    price = s * (1.01 * q - 1) - c * (q - 1)
    return [
        {"key": "price", "label": "+1% on menu prices", "monthly": price, "how": f"Sales {money(s)} × (1.01 × 1.01^{elasticity:.2f} − 1) minus the change in cost of goods; elasticity {elasticity:.2f} is the sales-weighted price response."},
        {"key": "labor", "label": "1 fewer labor hour a day", "monthly": rate * m["openDays"], "how": f"{money(rate, True)} an hour (with employer taxes) × {m['openDays']:.0f} open days a month."},
        {"key": "waste", "label": "10% less waste", "monthly": 0.1 * w, "how": f"10% of {money(w)} of logged waste a month at cost."},
        {"key": "covers", "label": "5% more guests", "monthly": 0.05 * (s - c), "how": f"5% of sales minus food cost ({money(s)} − {money(c)}), assuming the same team handles them."},
    ]


def labor_split(sales: np.ndarray, labor: np.ndarray) -> dict:
    """Daily labor = fixed + variable × sales (OLS). Falls back to all-variable if the fit is unusable."""
    if len(sales) >= 10 and np.std(sales) > 0:
        m = sm.OLS(labor, sm.add_constant(sales)).fit()
        a, b = float(m.params[0]), float(m.params[1])
        if a >= 0 and 0 <= b < 0.6:
            ci = m.conf_int(alpha=0.2)
            return {"fixed": a, "variable": b, "fixedLow": float(max(0, ci[0][0])), "fixedHigh": float(ci[0][1]), "r2": float(m.rsquared), "fitted": True}
    share = float(labor.sum() / sales.sum()) if sales.sum() else 0.3
    return {"fixed": 0.0, "variable": share, "fixedLow": 0.0, "fixedHigh": 0.0, "r2": 0.0, "fitted": False}


def break_even(fixed_month: float, split: dict, cogs_pct: float, waste_pct: float, open_days: float) -> dict | None:
    margin = 1 - cogs_pct - waste_pct - split["variable"]
    if margin <= 0.05:
        return None
    month = (fixed_month + split["fixed"] * open_days) / margin
    lo = (fixed_month + split["fixedLow"] * open_days) / margin
    hi = (fixed_month + split["fixedHigh"] * open_days) / margin if split["fitted"] else month
    return {"monthly": month, "daily": month / open_days, "dailyLow": lo / open_days, "dailyHigh": hi / open_days, "margin": margin}


def run(data: dict, price_result: dict | None = None) -> dict:
    as_of = data["asOf"]
    since = add_days(as_of, -28)
    recent = [x for x in data.get("days", []) if x["date"] >= since and x["date"] < as_of]
    open_recent = [x for x in recent if x.get("open") and (x.get("sales") or 0) > 0]
    if len(open_recent) < 10:
        return insight("drivers", "Profit drivers", status="thin", headline="Needs 2+ weeks of sales and timecards.", action="Nothing to do yet.", how=[])
    scale = DAYS_PER_MONTH / 28
    opm = open_days_per_month(data.get("days", []))
    tot = {k: sum(float(x.get(k) or 0) for x in recent) for k in ("sales", "cogs", "labor", "laborHours", "foodSales")}
    waste_days = [x for x in data.get("days", []) if x.get("wasteLogged")]
    waste_daily = (sum(float(x.get("waste") or 0) for x in waste_days) / len(waste_days)) if waste_days else 0.0
    m = {"sales": tot["sales"] * scale, "cogs": tot["cogs"] * scale, "labor": tot["labor"] * scale, "laborHours": tot["laborHours"] * scale, "waste": waste_daily * opm, "openDays": opm}
    fits = (price_result or {}).get("details", {}).get("items", [])
    w = sum(f["qtyMonth"] * f["price"] for f in fits)
    e = sum(f["elasticity"] * f["qtyMonth"] * f["price"] for f in fits) / w if w else -0.8
    levers = sorted(lever_values(m, e), key=lambda l: -l["monthly"])
    fixed = data.get("fixedCosts") or {}
    fixed_total = sum(float(v or 0) for v in fixed.values()) if fixed else 0.0
    allopen = [x for x in data.get("days", []) if x.get("open") and (x.get("sales") or 0) > 0 and (x.get("labor") or 0) > 0]
    split = labor_split(np.array([x["sales"] for x in allopen], dtype=float), np.array([x["labor"] for x in allopen], dtype=float))
    profit_before_fixed = m["sales"] - m["cogs"] - m["labor"] - m["waste"]
    be = break_even(fixed_total, split, m["cogs"] / m["sales"], m["waste"] / m["sales"], opm) if fixed_total > 0 else None
    top = levers[0]
    conf = confidence(len([x for x in data.get("days", []) if x.get("open")]), 0.05 if not split["fitted"] else 0.0)
    if be:
        avg_daily = m["sales"] / opm
        cushion = avg_daily / be["daily"] - 1
        headline = f"You break even at about {money(be['daily'])} a day ({money(be['dailyLow'])}–{money(be['dailyHigh'])}); you're averaging {money(avg_daily)} ({'+' if cushion >= 0 else ''}{round(cushion * 100)}%)"
    else:
        headline = f"Biggest lever: {top['label'].lower()} → about {money(top['monthly'])}/month"
    action = f"Focus on {top['label'].lower()} — it's worth {money(top['monthly'])}/month, more than {levers[1]['label'].lower()} ({money(levers[1]['monthly'])})."
    if not fixed_total:
        action += " Add rent, utilities and insurance below to see your break-even."
    how = [
        f"A month here is the last 28 days scaled to 30.4 days: sales {money(m['sales'])}, cost of goods {money(m['cogs'])} ({pct(m['cogs'] / m['sales'])}), labor {money(m['labor'])} ({pct(m['labor'] / m['sales'])}), waste {money(m['waste'])}.",
        *[f"{l['label']}: {l['how']}" for l in levers],
    ]
    if split["fitted"]:
        how.append(f"Break-even: a regression of daily labor on daily sales says labor is about {money(split['fixed'])} a day no matter what, plus {pct(split['variable'])} of each extra dollar (fits {pct(split['r2'])} of day-to-day changes). With food cost {pct(m['cogs'] / m['sales'])} and waste {pct(m['waste'] / m['sales'], 1)}, each extra dollar of sales leaves {pct(be['margin'] if be else 1 - m['cogs'] / m['sales'] - split['variable'])} to cover fixed costs.")
    inputs = [inp("Sales / month", money(m["sales"])), inp("Cost of goods / month", money(m["cogs"])), inp("Labor / month", money(m["labor"])), inp("Labor hours / month", f"{m['laborHours']:.0f}"), inp("Waste / month", money(m["waste"])), inp("Open days / month", f"{opm:.1f}"), inp("Price response", f"{e:.2f}"), inp("Fixed costs / month", money(fixed_total) if fixed_total else "not entered")]
    # Levers are what-ifs, not findings, so they don't go in the ranked list (the other models turn them into specific moves).
    opps: list[dict] = []
    return insight(
        "drivers",
        "Profit drivers & break-even",
        headline=headline,
        action=action,
        monthly=top["monthly"],
        confidence=conf,
        how=how,
        inputs=inputs,
        chart={"type": "bars", "unit": "money", "rows": [{"label": l["label"], "value": round(l["monthly"], 0)} for l in levers]},
        details={"levers": levers, "month": m, "profitBeforeFixed": profit_before_fixed, "profitAfterFixed": profit_before_fixed - fixed_total if fixed_total else None, "fixedTotal": fixed_total, "breakEven": be, "laborSplit": split, "elasticity": e},
        opportunities=opps,
    )
