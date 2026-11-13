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
(In the app this is "how far from a normal day", never a z-score.)

One-off days are things to know, not actions. The action is the pattern: on
slow days (sales well under normal) is the crew cut back? `slow_days` prices the
hours that weren't, over the last 26 weeks.
"""

from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.seasonal import STL

from .common import WEEKDAYS, WEEKS_PER_MONTH, add_days, confidence, inp, insight, money, opportunity, plural, robust_z, story, weekday

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
        if abs(z) >= 2.5 and not (z < 0 and r["sales"] < 0):
            typical = math.exp(r["ls"] - r["salesResid"])
            gap = r["sales"] - typical * (r["sales"] / math.exp(r["ls"]))
            out.append({"date": r["date"], "metric": "sales", "z": float(z), "dollars": float(gap), "normal": float(r["sales"] - gap), "actual": float(r["sales"]), "text": f"{day}: sales {money(r['sales'])}, about {money(abs(gap))} {'more' if gap > 0 else 'less'} than a normal {WEEKDAYS[r['wd']]}{ev}", "action": "Worth knowing why — something to repeat?" if gap > 0 else "Weather, a closure, or a quiet week in town? Nothing to fix if you know why.", "method": sales_method})
        lz = r.get("laborZ")
        if lz is not None and not pd.isna(lz) and lz >= 2.5:
            normal = r["laborNormal"]
            extra = r["labor"] - normal * r["sales"]
            hours = extra / hourly_cost
            shifts = hours / 6
            who = f"about {plural(shifts, 'extra shift')}" if shifts >= 0.75 else f"about {plural(hours, 'extra hour')}"
            out.append({"date": r["date"], "metric": "labor", "z": float(lz), "dollars": float(extra), "text": f"{day}: wages were {round(r['laborPct'] * 100)}% of sales (a normal {WEEKDAYS[r['wd']]} is {round(normal * 100)}%) — {who}", "action": "Check who stayed late or was called in.", "method": "weekday median"})
        fz = r.get("foodZ")
        if fz is not None and not pd.isna(fz) and abs(fz) >= 3:
            out.append({"date": r["date"], "metric": "food", "z": float(fz), "dollars": float((r["foodPct"] - r["foodNormal"]) * r["sales"]), "text": f"{day} food cost was {round((r['foodPct'] - r['foodNormal']) * 100)} points {'above' if fz > 0 else 'below'} normal", "action": "Usually the item mix — check what sold that day.", "method": "overall median"})
        wz = r.get("wasteZ")
        if wz is not None and not pd.isna(wz) and wz >= 3:
            out.append({"date": r["date"], "metric": "waste", "z": float(wz), "dollars": float(r["waste"] - r["wasteNormal"]), "text": f"{day} waste was {money(r['waste'])} vs {money(r['wasteNormal'])} on a normal day", "action": "Look at what was logged — over-prep or a delivery problem?", "method": "overall median"})
    # One line per day: a slow day with normal wages is one story, not two.
    by_date: dict[str, list[dict]] = {}
    for a in out:
        by_date.setdefault(a["date"], []).append(a)
    merged = []
    for date, xs in by_date.items():
        sales = next((a for a in xs if a["metric"] == "sales"), None)
        labor = next((a for a in xs if a["metric"] == "labor"), None)
        if sales and labor and sales["dollars"] < 0:
            sales = {**sales, "text": sales["text"] + " — and wages weren't cut back to match", "related": "labor"}
            merged.append(sales)
            merged += [a for a in xs if a["metric"] not in ("sales", "labor")]
        else:
            merged += xs
    merged.sort(key=lambda a: -abs(a["dollars"]))
    return merged


def slow_days(data: dict, weeks: int = 26) -> dict | None:
    """On slow days (under 70% of a normal day for that weekday), how many paid hours weren't trimmed?
    Expected hours on a slow day: half the crew is fixed (you need people to open), half scales with sales."""
    as_of = data["asOf"]
    since = add_days(as_of, -7 * weeks)
    min_crew = float(data.get("minCrew") or 2)
    days = [x for x in data.get("days", []) if x.get("open") and (x.get("sales") or 0) > 0 and (x.get("laborHours") or 0) > 0 and x["date"] >= since and not x.get("eventKinds")]
    if len(days) < 40:
        return None
    by_wd: dict[int, list[dict]] = {}
    for x in days:
        by_wd.setdefault(weekday(x["date"]), []).append(x)
    rate = sum(x["labor"] for x in days) / sum(x["laborHours"] for x in days)
    slow, extra_hours = [], 0.0
    for wd, xs in by_wd.items():
        if len(xs) < 8:
            continue
        med_s = float(np.median([x["sales"] for x in xs]))
        med_h = float(np.median([x["laborHours"] for x in xs]))
        for x in xs:
            ratio = x["sales"] / med_s if med_s else 1
            if ratio >= 0.7:
                continue
            expected = max(min_crew * 4, med_h * (0.5 + 0.5 * ratio))
            ex = x["laborHours"] - expected
            slow.append({"date": x["date"], "wd": wd, "sales": x["sales"], "normal": med_s, "hours": x["laborHours"], "normalHours": med_h, "extra": max(0.0, ex)})
            extra_hours += max(0.0, ex)
    trimmed = [s for s in slow if s["extra"] <= 0.5]
    if len(slow) < 6:
        return None
    monthly = extra_hours * rate / weeks * WEEKS_PER_MONTH
    if monthly < 60:
        return None
    worst_wd = max(set(s["wd"] for s in slow), key=lambda w: sum(s["extra"] for s in slow if s["wd"] == w))
    per_slow = extra_hours / len(slow)
    ws = [s for s in slow if s["wd"] == worst_wd]
    return opportunity(
        "anomaly.slowdays", "anomaly.slowdays", "anomalies",
        "Slow days still get a full crew",
        f"When it's quiet by mid-shift, send one person home early — {WEEKDAYS[worst_wd]}s most of all.",
        monthly, monthly * 0.5, monthly, 0.55,
        [f"In the last {weeks} weeks, {len(slow)} open days ran under 70% of a normal day for that weekday. On those days the team worked about {per_slow:.1f} more hours than a trimmed day would (half the crew stays — you need people to open — the other half follows sales)."],
        [inp("Slow days", len(slow)), inp("Trimmed already", len(trimmed)), inp("Extra hours on slow days", f"{extra_hours:.0f}"), inp("Average wage with taxes", money(rate, True))],
        href="/schedule", subject="slowdays", area="staffing", effort="easy", vector="save",
        story=story(
            f"{len(slow)} days in the last {weeks} weeks ran well under normal — like a {WEEKDAYS[worst_wd]} doing a third less than usual.",
            f"On those days the crew mostly stayed the same: about {per_slow:.1f} more paid hours than a trimmed day. Only {len(trimmed)} of {len(slow)} were cut back.",
            f"Check sales at the halfway point of a shift. If it's well under a normal {WEEKDAYS[worst_wd]}, send one person home.",
            f"About {money(monthly)} a month.",
        ),
        visual={"type": "compare", "unit": "number", "rows": [{"label": f"Paid hours, a normal {WEEKDAYS[worst_wd]}", "value": round(ws[0]["normalHours"], 1)}, {"label": f"A slow {WEEKDAYS[worst_wd]} (median)", "value": round(float(np.median([s['hours'] for s in ws])), 1), "tone": "bad"}, {"label": f"A slow {WEEKDAYS[worst_wd]}, trimmed", "value": round(float(np.median([s['hours'] - s['extra'] for s in ws])), 1), "tone": "good"}]},
    )


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
        "Sales are compared with the weekly rhythm and the recent trend; wages as a share of sales with the same weekday; food cost with your usual level.",
        "A day only shows up when it's far further from normal than your ordinary day-to-day ups and downs — about 1 day in 50 would by chance.",
    ]
    if waste_days < 14:
        how.append(f"Waste isn't checked yet: it's been logged on {waste_days} days, and we need 14 to know a normal day.")
    if not found:
        sd = slow_days(data)
        return insight("anomalies", "Unusual days", headline=f"Nothing unusual in the last {LOOKBACK} days", action="Nothing to chase.", confidence=conf, how=how, inputs=[inp("Open days of history", n_open)], details={"items": []}, opportunities=[sd] if sd else [])
    top = found[0]
    # One-off days are worth knowing, not actions; the pattern behind them is.
    sd = slow_days(data)
    opps = [sd] if sd else []
    return insight(
        "anomalies",
        "Unusual days",
        headline=top["text"],
        action=top["action"],
        confidence=conf,
        how=how,
        inputs=[inp(a["date"], a["text"].split(": ", 1)[-1]) for a in found[:8]],
        chart={"type": "list", "rows": [{"date": a["date"], "metric": a["metric"], "z": round(a["z"], 1), "text": a["text"]} for a in found[:5]]},
        details={"items": found[:8]},
        opportunities=opps,
    )
