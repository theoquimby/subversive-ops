"""Insights Lab additions: data prep, seasons, the week, slow days, merged root causes, plain English."""

import json
import math
import re
from datetime import date, timedelta

import numpy as np

from conftest import make_data
from subops import anomalies, feed, forecast, seasons, staffing, week
from subops.common import open_windows, plural, prepare, weeks_label
from subops.engine import analyze

JARGON = ("sarimax", "z-score", "kasavana", "elasticity", "regression", "holt-winters", "stl", "mape", "splh")


def has_jargon(text: str) -> bool:
    return any(re.search(rf"\b{re.escape(j)}\b", text) for j in JARGON)


def years_of_days(n_years=3, seed=3):
    """Daily sales with a real yearly shape (slow Jan, busy Aug), closed Tuesdays with the odd stray sale."""
    rng = np.random.default_rng(seed)
    start = date(2026, 11, 13) - timedelta(days=int(365.25 * n_years))
    wd_mult = {0: 0.5, 1: 0.0, 2: 0.55, 3: 0.6, 4: 1.2, 5: 2.0, 6: 1.1}
    days = []
    for i in range(int(365.25 * n_years)):
        dt = start + timedelta(days=i)
        season = 1 + 0.4 * math.sin(2 * math.pi * (dt.timetuple().tm_yday - 120) / 365.25)
        m = wd_mult[dt.weekday()]
        if m == 0:
            stray = rng.random() < 0.15
            days.append({"date": dt.isoformat(), "open": stray, "sales": 90.0 if stray else 0, "orders": 2 if stray else 0, "labor": 0, "laborHours": 0})
            continue
        s = 2000 * m * season * math.exp(rng.normal(0, 0.12))
        hours = 10 + s / 150
        days.append({"date": dt.isoformat(), "open": True, "sales": s, "orders": s / 30, "labor": hours * 20, "laborHours": hours, "cogs": 0, "foodSales": 0})
    as_of = (start + timedelta(days=len(days))).isoformat()
    future = [{"date": (date.fromisoformat(as_of) + timedelta(days=j)).isoformat(), "eventMult": 1.0} for j in range(14)]
    return {"asOf": as_of, "days": days, "future": future, "items": [], "hourly": [], "minCrew": 2}


def test_prepare_drops_stray_sales_and_closed_weekdays():
    data = years_of_days(1)
    p = prepare(data)
    assert p["strayDays"] > 0
    assert 1 in data["closedWeekdays"]
    assert not any(x["open"] for x in data["days"] if date.fromisoformat(x["date"]).weekday() == 1)


def test_forecast_on_years_is_sane_and_plain():
    data = years_of_days(3)
    prepare(data)
    r = forecast.run(data)
    assert r["status"] == "ok"
    wk = r["details"]["week"]
    assert wk["low"] > wk["mid"] * 0.7 and wk["high"] < wk["mid"] * 1.35  # a week's range, not $5k–$20k
    assert r["details"]["mape"] < 0.2
    assert all(x["closed"] for x in r["details"]["days"] if date.fromisoformat(x["date"]).weekday() == 1)
    text = " ".join([r["headline"], r["action"], *r["how"]]).lower()
    assert not has_jargon(text), text


def test_seasons_finds_the_slow_and_busy_months():
    data = years_of_days(3)
    prepare(data)
    r = seasons.run(data)
    assert r["status"] == "ok"
    assert r["details"]["slow"] in (0, 1, 11)  # Dec–Feb
    assert r["details"]["busy"] in (5, 6, 7)
    assert seasons.run({"asOf": "2026-11-13", "days": years_of_days(1)["days"][-200:]})["status"] == "thin"


def test_week_flags_a_day_that_costs_more_than_it_brings():
    data = years_of_days(1)
    for x in data["days"]:
        if date.fromisoformat(x["date"]).weekday() == 0 and x["open"]:
            x["sales"], x["labor"], x["laborHours"] = 300.0, 400.0, 20.0
    prepare(data)
    r = week.run(data)
    assert any(o["subject"] == "0" for o in r["opportunities"])
    assert r["opportunities"][0]["effort"] == "hard" and r["opportunities"][0]["story"]["todo"]


def test_slow_days_pattern_replaces_one_off_labor_flags():
    data = years_of_days(1)
    rng = np.random.default_rng(1)
    for x in data["days"][-180:]:
        if x["open"] and rng.random() < 0.2:
            x["sales"] *= 0.45  # slow, but the crew stayed
    prepare(data)
    r = anomalies.run(data)
    assert not any(o["kind"] == "anomaly.labor" for o in r["opportunities"])
    assert any(o["kind"] == "anomaly.slowdays" for o in r["opportunities"])


def test_staffing_and_hours_merge_into_one_root_cause():
    data = make_data()
    data["openingHours"] = {str(k): [16, 23] for k in (0, 1, 3, 4, 5, 6)}
    for r in data["hourly"]:
        if date.fromisoformat(r["date"]).weekday() == 0 and r["hour"] == 16:
            r["laborHours"], r["laborCost"] = 5, 100  # dead first hour, five people on
    st = staffing.run(data)
    out = feed.run(data, {"staffing": st})
    leads = [o for o in out["items"] if o.get("lead")]
    assert leads and leads[0]["group"].startswith("slot.0.")
    assert "bigger of the two" in leads[0]["story"]["gain"]


def test_setup_hours_never_judged():
    data = make_data()
    w = open_windows(data)
    assert w[0] == (17, 23)  # Monday 4pm sells almost nothing: setup, not service


def test_grammar_helpers():
    assert plural(1, "person", "people") == "1 person"
    assert plural(3, "person", "people") == "3 people"
    assert plural(1, "extra shift") == "1 extra shift"
    assert weeks_label(1096) == "3 years"
    assert weeks_label(200) == "7 months"


def test_engine_on_years_is_fast_plain_and_serialises():
    data = years_of_days(4)
    import time

    t = time.time()
    out = analyze({"data": data})
    assert time.time() - t < 20
    json.dumps(out, default=float)
    for k, r in out["results"].items():
        if k == "feed":
            continue
        text = " ".join([r.get("headline", ""), r.get("action", "")] + [o["title"] + " " + o["action"] for o in r.get("opportunities", [])]).lower()
        assert not has_jargon(text), (k, text)
    assert out["data"]["strayDays"] > 0
