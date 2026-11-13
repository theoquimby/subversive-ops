import json
import math
import time

import numpy as np

from conftest import AS_OF, make_data
from subops import anomalies, drivers, forecast, menu, orders, price, staffing
from subops.common import robust_z, shrink
from subops.engine import analyze


def test_shrink_and_robust_z():
    m, sd = shrink(-2.0, 0.1, -0.8, 0.4)
    assert -2.0 < m < -1.8 and sd < 0.1
    m, sd = shrink(-2.0, 2.0, -0.8, 0.4)
    assert abs(m + 0.85) < 0.1
    z = robust_z([1, 1, 1, 1.1, 0.9, 10])
    assert z[-1] > 10 and abs(z[0]) < 1


def test_price_recovers_elasticity_from_a_real_change():
    data = make_data(elasticity=-1.5, seed=3)
    r = price.run(data)
    pz = next(x for x in r["details"]["items"] if x["id"] == "pretzel")
    assert pz["source"] == "measured"
    assert len(pz["changes"]) == 1 and pz["changes"][0]["to"] == 14.0
    assert -2.0 < pz["elasticity"] < -1.0  # true −1.5, shrunk toward the −1.0 snack prior


def test_price_without_changes_uses_prior_and_says_so():
    data = make_data()
    for it in data["items"]:
        it["daily"] = {k: [v[0], v[0] * 13.0] for k, v in it["daily"].items()} if it["id"] == "pretzel" else it["daily"]
    r = price.run(data)
    pz = next(x for x in r["details"]["items"] if x["id"] == "pretzel")
    assert pz["source"] == "typical" and pz["elasticity"] == price.PRIORS["snack"][0]


def test_what_if_is_consistent():
    w = price.what_if(10, 3, 100, -1.0, 1.0)
    assert math.isclose(w["qty"], 100 * (11 / 10) ** -1.0)
    assert math.isclose(w["profit"], w["qty"] * 8 - 700)


def test_menu_classifies_known_quadrants():
    rows = menu.classify([{"qty": 100, "cm": 10}, {"qty": 100, "cm": 4}, {"qty": 10, "cm": 12}, {"qty": 10, "cm": 3}])
    assert [r["cls"] for r in rows] == ["Star", "Workhorse", "Puzzle", "Dog"]


def test_menu_best_price_is_cautious_and_capped():
    bp = menu.best_price(14.0, 4.0, 200, -0.5, 0.3, 0.12)
    assert bp is not None and bp["price"] <= 14.0 * 1.12 and bp["cautious"] <= bp["gain"] <= bp["high"]
    assert menu.best_price(10.0, 1.0, 100, -3.0, 0.1) is None  # very elastic, fat margin: no move pays


def test_menu_run_finds_an_opportunity(data):
    r = menu.run(data)
    assert r["status"] == "ok"
    assert {p["cls"] for p in r["chart"]["points"]} <= {"Star", "Workhorse", "Puzzle", "Dog"}
    assert r["opportunities"] and r["monthly"] > 0


def test_menu_leaves_out_bad_costs(data):
    data["items"][0]["unitCost"] = 99.0
    r = menu.run(data)
    assert any(b["id"] == "burger" for b in r["details"]["badCost"])


def test_forecast_ranges_cover_and_beat_naive(data):
    r = forecast.run(data)
    assert r["status"] == "ok"
    days = [x for x in r["details"]["days"] if not x["closed"]]
    assert days and all(x["low"] < x["mid"] < x["high"] for x in days)
    # closed Tuesdays get no range
    assert all(x["closed"] for x in r["details"]["days"] if __import__("datetime").date.fromisoformat(x["date"]).weekday() == 1)
    assert r["details"]["coverage"] >= 0.6
    assert r["details"]["mape"] < 0.2


def test_forecast_thin_history():
    data = make_data()
    data["days"] = data["days"][:15]
    assert forecast.run(data)["status"] == "thin"


def test_newsvendor_trims_perishable_overorder():
    ing = {"id": "fries", "name": "Fries", "category": "Produce", "packQty": 5000, "packCost": 40, "onHand": 2000, "onHandKnown": True, "forecast": [1500] * 4, "coverDays": 4, "currentPacks": 2, "marginPerBase": 0.0, "usage": {f"2026-10-{i:02d}": 1500 + (i % 3) * 100 for i in range(1, 29)}}
    p = orders.plan(ing)
    # need ~6,000, have 2,000 → 1 pack leaves a small chance of running out; 2 packs mostly spoils
    assert p["best"] == 1 and p["savingWeekly"] > 0
    assert p["stockoutBest"] < 0.5


def test_newsvendor_keeps_generous_for_shelf_stable():
    ing = {"id": "salt", "name": "Salt", "category": "Pantry", "packQty": 1000, "packCost": 4, "onHand": 0, "onHandKnown": True, "forecast": [200] * 7, "coverDays": 7, "currentPacks": 1, "marginPerBase": 0.5, "usage": {}}
    p = orders.plan(ing)
    assert p["best"] >= 2  # running out of salt is far worse than holding a box


def test_anomaly_flags_labor_spike():
    data = make_data(labor_spike_day=64)
    r = anomalies.run(data)
    assert any(a["metric"] == "labor" for a in r["details"]["items"])


def test_anomaly_quiet_on_normal_data():
    data = make_data(seed=11)
    r = anomalies.run(data)
    assert not any(a["metric"] == "labor" and a["z"] >= 3 for a in r["details"].get("items", []))


def test_drivers_levers_and_break_even(data):
    lv = {l["key"]: l["monthly"] for l in drivers.lever_values({"sales": 60000, "cogs": 18000, "labor": 15000, "waste": 1000, "laborHours": 750, "openDays": 26}, -0.8)}
    assert math.isclose(lv["labor"], 20 * 26)
    assert math.isclose(lv["waste"], 100)
    assert math.isclose(lv["covers"], 0.05 * 42000)
    assert 0 < lv["price"] < 600  # less than 1% of sales because volume dips
    split = drivers.labor_split(np.array([1000, 2000, 3000, 1500, 2500, 1200, 2800, 1800, 2200, 2600.0]), np.array([180 + 0.18 * s for s in [1000, 2000, 3000, 1500, 2500, 1200, 2800, 1800, 2200, 2600.0]]))
    assert abs(split["fixed"] - 180) < 1 and abs(split["variable"] - 0.18) < 0.01
    be = drivers.break_even(10000, split, 0.3, 0.02, 26)
    assert math.isclose(be["monthly"], (10000 + 180 * 26) / (1 - 0.3 - 0.02 - 0.18))
    data["fixedCosts"] = {"rent": 6000, "utilities": 1500, "insurance": 500}
    r = drivers.run(data)
    assert r["details"]["breakEven"]["daily"] > 0 and "break even" in r["headline"]


def test_staffing_finds_dead_monday_hour_and_thin_saturday(data):
    r = staffing.run(data)
    assert r["status"] == "ok"
    names = [(o["wd"], o["hour"]) for o in r["details"]["over"]]
    assert (0, 16) not in names  # min crew of 2 protects it; the open-hours finder handles dead hours
    assert any(u["wd"] == 5 and u["hour"] == 19 for u in r["details"]["under"])


def test_engine_runs_everything_fast_and_serialises(data):
    t = time.time()
    out = analyze({"models": None, "data": data})
    assert time.time() - t < 30
    assert set(out["results"]) >= {"price", "menu", "forecast", "orders", "anomalies", "drivers", "staffing", "feed"}
    assert all(r.get("status") != "error" for r in out["results"].values()), {k: v["how"] for k, v in out["results"].items() if v.get("status") == "error"}
    json.dumps(out, default=float)
    for k, r in out["results"].items():
        if k != "feed":
            assert r["headline"] and r["confidence"]["note"]


def test_open_days_per_month_ignores_days_before_history():
    from subops.common import open_days_per_month

    data = make_data()
    lead = [{"date": f"2026-08-{i:02d}", "open": False, "sales": 0} for i in range(1, 32)]
    # closed Tuesdays only: 6 open days in 7
    assert abs(open_days_per_month(lead + data["days"]) - 30.4 * 6 / 7) < 0.6


def test_price_skips_items_with_suspect_costs():
    data = make_data()
    data["items"][0]["unitCost"] = 25.0  # burger costs more than it sells for: a typo upstream
    r = price.run(data)
    assert all(x["id"] != "burger" for x in r["details"]["items"])
    assert "Burger" in " ".join(r["how"])
