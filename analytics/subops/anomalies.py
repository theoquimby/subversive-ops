"""Unusual days.

Each daily measure is compared with what's normal for that kind of day:
- sales: log(sales ÷ planned event impact), seasonal-trend decomposition
  (STL, robust, one season = one week of open days) when there are 4+ weeks,
  otherwise the same-weekday median; the leftover is what's unusual;
- labor %: against the same-weekday median;
- food cost %: against the overall median (it barely depends on weekday);
- waste $: against the median day, once waste has been logged for 2+ weeks.

Leftovers are scored with a robust z-score ((x − median) ÷ 1.4826·MAD), so one
crazy day can't hide another. |z| ≥ 3 is unusual; 2.5–3 is "worth a look".
"""

from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.seasonal import STL

from .common import WEEKDAYS, add_days, confidence, inp, insight, money, opportunity, robust_z, weekday

LOOKBACK = 14


def _weekday_resid(df: pd.DataFrame, col: str) -> pd.Series:
    med = df.groupby("wd")[col].transform("median")
    return df[col] - med


def scores(days: list[dict], as_of: str) -> list[dict]:
    rows = []
    for x in days:
        if not x.get("open") or (x.get("sales") or 0) <= 0:
            continue
        mult = x.get("eventMult") or 1.0
        rows.append({
            "date": x["date"],
            "wd": weekday(x["date"]),
            "sales": float(x["sales"]),
            "ls": math.log(float(x["sales"]) / (mult if mult > 0 else 1.0)),
            "labor": float(x.get("labor") or 0),
            "laborHours": float(x.get("laborHours") or 0),
            "laborPct": (x.get("labor") or 0) / x["sales"] if x.get("labor") else np.nan,
            "foodPct": (x.get("cogs") or 0) / x["foodSales"] if x.get("foodSales") else np.nan,
            "waste": float(x.get("waste") or 0) if x.get("wasteLogged") else np.nan,
            "events": x.get("eventTitles") or [],
        })
    df = pd.DataFrame(rows)
    if len(df) < 14:
        return []
    period = max(2, df["wd"].nunique())
    if len(df) >= 4 * period:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            stl = STL(df["ls"].values, period=period, robust=True).fit()
        df["salesResid"] = stl.resid
        sales_method = "STL"
    else:
        df["salesResid"] = _weekday_resid(df, "ls")
        sales_method = "weekday median"
    df["salesZ"] = robust_z(df["salesResid"])
    lp = df.dropna(subset=["laborPct"])
    if len(lp) >= 14:
        df.loc[lp.index, "laborResid"] = _weekday_resid(lp, "laborPct")
        df.loc[lp.index, "laborZ"] = robust_z(df.loc[lp.index, "laborResid"])
        df.loc[lp.index, "laborNormal"] = lp.groupby("wd")["laborPct"].transform("median")
    fp = df.dropna(subset=["foodPct"])
    if len(fp) >= 14:
        df.loc[fp.index, "foodZ"] = robust_z(fp["foodPct"])
        df["foodNormal"] = float(fp["foodPct"].median())
    wp = df.dropna(subset=["waste"])
    if len(wp) >= 14:
        df.loc[wp.index, "wasteZ"] = robust_z(wp["waste"])
        df["wasteNormal"] = float(wp["waste"].median())
    since = add_days(as_of, -LOOKBACK)
    hourly_cost = (df["labor"].sum() / df["laborHours"].sum()) if df["laborHours"].sum() > 0 else 20.0
    out = []
    for _, r in df[df["date"] >= since].iterrows():
        day = f"{WEEKDAYS[r['wd']]} {pd.Timestamp(r['date']).strftime('%b')} {pd.Timestamp(r['date']).day}"
        ev = f" ({', '.join(r['events'])})" if r["events"] else ""
        z = r["salesZ"]
        if abs(z) >= 2.5:
            typical = math.exp(r["ls"] - r["salesResid"])
            gap = r["sales"] - typical * (r["sales"] / math.exp(r["ls"]))
            out.append({"date": r["date"], "metric": "sales", "z": float(z), "dollars": float(gap), "text": f"{day} sales were {money(abs(gap))} {'above' if gap > 0 else 'below'} a normal {WEEKDAYS[r['wd']]}{ev}", "action": "Worth knowing why — a one-off, or something to repeat?" if gap > 0 else "Check for a missed sync, a closure or a slow-service night.", "method": sales_method})
        lz = r.get("laborZ")
        if lz is not None and not pd.isna(lz) and lz >= 2.5:
            normal = r["laborNormal"]
            extra = r["labor"] - normal * r["sales"]
            hours = extra / hourly_cost
            shifts = hours / 6
            who = f"about {round(shifts)} extra {'shift' if round(shifts) == 1 else 'shifts'}" if shifts >= 0.75 else f"about {hours:.0f} extra hours"
            out.append({"date": r["date"], "metric": "labor", "z": float(lz), "dollars": float(extra), "text": f"{day} labor was {round((r['laborPct'] - normal) * 100)} points above normal ({round(r['laborPct'] * 100)}% vs {round(normal * 100)}%) — {who}, ≈ {money(extra)}", "action": "Check who stayed late or was called in, and whether the schedule had it.", "method": "weekday median"})
        fz = r.get("foodZ")
        if fz is not None and not pd.isna(fz) and abs(fz) >= 3:
            out.append({"date": r["date"], "metric": "food", "z": float(fz), "dollars": float((r["foodPct"] - r["foodNormal"]) * r["sales"]), "text": f"{day} food cost was {round((r['foodPct'] - r['foodNormal']) * 100)} points {'above' if fz > 0 else 'below'} normal", "action": "Usually the item mix — check what sold that day.", "method": "overall median"})
        wz = r.get("wasteZ")
        if wz is not None and not pd.isna(wz) and wz >= 3:
            out.append({"date": r["date"], "metric": "waste", "z": float(wz), "dollars": float(r["waste"] - r["wasteNormal"]), "text": f"{day} waste was {money(r['waste'])} vs {money(r['wasteNormal'])} on a normal day", "action": "Look at what was logged — over-prep or a delivery problem?", "method": "overall median"})
    out.sort(key=lambda a: -abs(a["dollars"]))
    return out


def run(data: dict) -> dict:
    days = data.get("days", [])
    n_open = len([x for x in days if x.get("open")])
    found = scores(days, data["asOf"])
    if n_open < 14:
        return insight("anomalies", "Unusual days", status="thin", headline="Needs 2+ weeks of sales to know what's normal.", action="Nothing to do yet.", how=["An unusual day only stands out against a few weeks of normal ones."])
    waste_days = len([x for x in days if x.get("wasteLogged")])
    conf = confidence(n_open)
    how = [
        f"For every day in the last {LOOKBACK} days we compared sales, labor %, food cost % and waste with what's normal for that kind of day, using {n_open} open days of history. Planned events are allowed for, so a festival that went as expected isn't flagged.",
        "Sales use a seasonal-trend decomposition (STL) of the daily series; labor % is compared with the same weekday's median; food cost % with the overall median.",
        "We score how far off each day is with a robust z-score — distance from the median in units of typical day-to-day wobble (median absolute deviation), so one wild day can't hide another. 3+ is unusual, 2.5–3 is worth a look.",
    ]
    if waste_days < 14:
        how.append(f"Waste isn't checked yet: it's been logged on {waste_days} days, and we need 14 to know a normal day.")
    if not found:
        return insight("anomalies", "Unusual days", headline=f"Nothing unusual in the last {LOOKBACK} days", action="Nothing to chase.", confidence=conf, how=how, inputs=[inp("Open days of history", n_open)], details={"items": []})
    top = found[0]
    opps = []
    for a in found[:4]:
        if a["metric"] == "labor" and a["dollars"] > 40:
            opps.append(opportunity(f"anomaly.labor.{a['date']}", "anomaly.labor", "anomalies", a["text"], a["action"], a["dollars"], a["dollars"] * 0.6, a["dollars"], min(0.8, 0.3 + 0.1 * a["z"]), [f"Robust z-score {a['z']:.1f} against the same weekday's labor %."], [inp("Date", a["date"]), inp("Extra labor", money(a["dollars"]))], subject=a["date"]))
    return insight(
        "anomalies",
        "Unusual days",
        headline=top["text"],
        action=top["action"],
        confidence=conf,
        how=how,
        inputs=[inp(a["date"], f"{a['metric']}: z = {a['z']:.1f}, {money(a['dollars'])}") for a in found],
        chart={"type": "list", "rows": [{"date": a["date"], "metric": a["metric"], "z": round(a["z"], 1), "text": a["text"]} for a in found[:5]]},
        details={"items": found[:8]},
        opportunities=opps,
    )
