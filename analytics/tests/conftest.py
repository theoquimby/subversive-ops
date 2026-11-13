"""Synthetic restaurant data where the right answers are known."""

import math
import os
import sys
from datetime import date, timedelta

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

WD_MULT = {0: 0.6, 1: 0.0, 2: 0.65, 3: 0.75, 4: 1.1, 5: 1.4, 6: 1.1}  # Mon..Sun, closed Tuesday
START = date(2026, 9, 1)
N_DAYS = 70
AS_OF = (START + timedelta(days=N_DAYS)).isoformat()


def make_data(seed=1, elasticity=-1.2, change_day=35, base=2000.0, rain_effect=-0.15, event_days=None, event_lift=0.4, planned_lift=0.2, labor_spike_day=None):
    rng = np.random.default_rng(seed)
    event_days = event_days if event_days is not None else {12: "GAME", 26: "GAME", 47: "GAME", 61: "GAME"}
    days, hourly, items_daily = [], [], {"burger": {}, "fries": {}, "chx": {}, "pretzel": {}}
    prices = {"burger": 19.0, "fries": 7.0, "chx": 18.0, "pretzel": 13.0}
    costs = {"burger": 5.5, "fries": 1.4, "chx": 4.8, "pretzel": 3.0}
    base_qty = {"burger": 30.0, "fries": 22.0, "chx": 18.0, "pretzel": 6.0}
    for i in range(N_DAYS):
        dt = START + timedelta(days=i)
        iso = dt.isoformat()
        wd = dt.weekday()
        m = WD_MULT[wd]
        if m == 0:
            days.append({"date": iso, "open": False, "sales": 0})
            continue
        wet = rng.random() < 0.25
        ev = event_days.get(i)
        mult = m * (1 + (rain_effect if wet else 0)) * (1 + (event_lift if ev else 0)) * math.exp(rng.normal(0, 0.06))
        sales = base * mult
        orders = sales / 32
        labor = 180 + 0.18 * sales + rng.normal(0, 15)
        if labor_spike_day is not None and i == labor_spike_day:
            labor += 260
        hours = labor / 20
        days.append({"date": iso, "open": True, "sales": sales, "orders": orders, "labor": labor, "laborHours": hours, "cogs": 0.3 * sales, "foodSales": 0.6 * sales, "waste": 40 + rng.normal(0, 5), "wasteLogged": i > 40, "eventMult": 1 + planned_lift if ev else 1.0, "eventKinds": [ev] if ev else [], "eventTitles": ["Knicks game"] if ev else [], "wet": wet, "hasWeather": True, "tempMaxC": 15.0})
        for k in items_daily:
            p = prices[k] + (1.0 if (k == "pretzel" and i >= change_day) else 0.0)
            ratio = (p / prices[k]) ** (elasticity if k == "pretzel" else 0)
            q = max(1, rng.poisson(base_qty[k] * m * ratio * (orders / (base / 32) / m)))
            items_daily[k][iso] = [float(q), float(q * p)]
        # hours 16..22; the 16:00 hour is dead on Mondays but staffed with 2 people
        shape = {16: 0.03, 17: 0.12, 18: 0.2, 19: 0.22, 20: 0.2, 21: 0.15, 22: 0.08}
        for h, sh in shape.items():
            s = sales * sh * (0.15 if (wd == 0 and h == 16) else 1)
            people = 2 if (wd == 0 and h == 16) else max(2, s / 140)
            if wd == 5 and h == 19:
                people = s / 260  # Saturday peak is thin
            hourly.append({"date": iso, "hour": h, "sales": s, "orders": s / 32, "laborHours": people, "laborCost": people * 20})
    items = [
        {"id": k, "name": {"burger": "Burger", "fries": "Fries", "chx": "Hot chicken", "pretzel": "Pretzel"}[k], "category": {"burger": "Mains", "fries": "Sides", "chx": "Mains", "pretzel": "Snacks"}[k], "group": "food", "kind": "MENU", "price": prices[k] + (1 if k == "pretzel" else 0), "unitCost": costs[k], "daily": items_daily[k]}
        for k in items_daily
    ]
    future = [{"date": (START + timedelta(days=N_DAYS + j)).isoformat(), "eventMult": 1.0, "wet": False, "tempMaxC": 12.0, "tsForecast": base * WD_MULT[(START + timedelta(days=N_DAYS + j)).weekday()]} for j in range(14)]
    ts_backtest = [{"date": x["date"], "forecast": base * WD_MULT[date.fromisoformat(x["date"]).weekday()] * (x.get("eventMult") or 1), "actual": x["sales"]} for x in days if x["open"]][-28:]
    return {"asOf": AS_OF, "days": days, "future": future, "tsBacktest": ts_backtest, "items": items, "hourly": hourly, "ingredients": [], "fixedCosts": None, "burdenPct": 0.1}


@pytest.fixture
def data():
    return make_data()
