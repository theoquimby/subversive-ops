"""Runs the requested models in dependency order. One failing model never stops the others."""

from __future__ import annotations

import time
import traceback
from datetime import datetime, timezone

from . import VERSION, anomalies, drivers, feed, forecast, menu, orders, price, seasons, staffing, week
from .common import insight, prepare

ALL = ["price", "menu", "forecast", "orders", "anomalies", "drivers", "staffing", "seasons", "week", "feed"]
TITLES = {"price": "Price response", "menu": "Menu engineering", "forecast": "Forecast ranges", "orders": "Order quantities", "anomalies": "Unusual days", "drivers": "Profit drivers & break-even", "staffing": "Staffing by hour", "seasons": "Your seasons", "week": "Your week", "feed": "Insight feed"}


def analyze(payload: dict) -> dict:
    data = payload.get("data") or {}
    prep = prepare(data)
    wanted = [m for m in ALL if m in (payload.get("models") or ALL)]
    # menu and drivers use the price response; the feed uses everything.
    if ("menu" in wanted or "drivers" in wanted or "feed" in wanted) and "price" not in wanted:
        wanted.insert(0, "price")
    if "feed" in wanted:
        for dep in ("menu", "staffing", "anomalies"):
            if dep not in wanted:
                wanted.insert(wanted.index("feed"), dep)
    results: dict[str, dict] = {}
    timings: dict[str, float] = {}
    for m in wanted:
        t = time.time()
        try:
            if m == "price":
                results[m] = price.run(data)
            elif m == "menu":
                results[m] = menu.run(data, results.get("price"))
            elif m == "forecast":
                results[m] = forecast.run(data)
            elif m == "orders":
                results[m] = orders.run(data)
            elif m == "anomalies":
                results[m] = anomalies.run(data)
            elif m == "drivers":
                results[m] = drivers.run(data, results.get("price"))
            elif m == "staffing":
                results[m] = staffing.run(data)
            elif m == "seasons":
                results[m] = seasons.run(data)
            elif m == "week":
                results[m] = week.run(data)
            elif m == "feed":
                st = results.get("staffing", {}).get("details", {})
                results[m] = feed.run(data, {**results, "splh": st.get("splh"), "wage": st.get("wage")})
        except Exception as e:  # noqa: BLE001
            results[m] = insight(m, TITLES[m], status="error", headline="This one couldn't be worked out this time.", action="It retries overnight.", how=[f"{type(e).__name__}: {e}"], details={"trace": traceback.format_exc()[-2000:]})
        timings[m] = round(time.time() - t, 3)
    return {"version": VERSION, "computedAt": datetime.now(timezone.utc).isoformat(), "results": results, "timings": timings, "data": prep}
