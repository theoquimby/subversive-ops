"""Each finder on synthetic data where the right answer is known."""

from conftest import make_data
from subops import feed, menu, price, staffing


def kinds(xs):
    return [x["kind"] for x in xs]


def test_open_hours_flags_dead_monday_opening():
    data = make_data()
    out = feed.open_hours(data, {})
    assert any(o["subject"] == "0.16" for o in out), [o["title"] for o in out]
    o = next(o for o in out if o["subject"] == "0.16")
    assert "Open at 5pm" in o["action"] and o["monthly"] > 0 and o["low"] <= o["monthly"]


def test_event_roi_and_mis_planned_impact():
    data = make_data(event_lift=0.45, planned_lift=0.2)
    out = feed.event_roi(data, {})
    roi = next(o for o in out if o["kind"] == "feed.event.roi")
    assert "Knicks nights" in roi["title"]
    imp = next(o for o in out if o["kind"] == "feed.event.impact")
    assert "not the +20%" in imp["title"]


def test_event_roi_silent_when_plan_is_right():
    data = make_data(event_lift=0.2, planned_lift=0.2)
    assert "feed.event.impact" not in kinds(feed.event_roi(data, {}))


def test_price_creep_and_typo():
    data = make_data()
    data["priceHistory"] = [
        {"productId": "a", "product": "Fries 6/5", "ingredient": "Fries", "supplier": "HVF", "points": [["2026-03-01", 40.0], ["2026-10-01", 48.0]], "monthlySpend": 600},
        {"productId": "b", "product": "Garlic", "ingredient": "Garlic", "supplier": "HVF", "points": [["2026-03-01", 18.0], ["2026-10-01", 22.0]], "monthlySpend": 100},
        {"productId": "c", "product": "Loaf", "ingredient": "Sourdough", "supplier": "Bakery", "points": [["2026-03-01", 6.5], ["2026-11-01", 9.0], ["2026-11-02", 99.0]], "monthlySpend": 200},
        {"productId": "d", "product": "Salt", "ingredient": "Salt", "supplier": "Steady Co", "points": [["2026-03-01", 4.0], ["2026-10-01", 4.05]], "monthlySpend": 300},
    ]
    out = feed.price_creep(data, {})
    assert any(o["kind"] == "feed.price.typo" and o["subject"] == "c" for o in out)
    creep = [o for o in out if o["kind"] == "feed.price.creep"]
    # Steady Co is at inflation; the bakery's real rise (6.50 → 9.00) still counts once the typo is dropped.
    assert sorted(o["subject"] for o in creep) == ["Bakery", "HVF"]
    bakery = next(o for o in creep if o["subject"] == "Bakery")
    assert "9.00" in " ".join(bakery["how"]) and "99" not in " ".join(bakery["how"])
    assert creep[0]["monthly"] > 0


def test_leaks_annualise_gap_waste_and_invoices():
    data = make_data()
    data["variance"] = {"from": "2026-11-02", "to": "2026-11-09", "days": 7, "unexplainedCost": 140.0, "rows": [{"name": "Ground beef", "unexplainedCost": 90.0}]}
    data["invoices"] = {"priceIssues": 2, "priceIssueDollars": 37.5}
    out = feed.leaks(data, {})
    gap = next(o for o in out if o["kind"] == "feed.leak.gap")
    assert abs(gap["monthly"] - 140 / 7 * 30.4) < 1
    assert any(o["kind"] == "feed.leak.waste" for o in out)
    inv = next(o for o in out if o["kind"] == "feed.leak.invoices")
    assert inv["oneOff"] == 37.5


def test_pour_yield():
    data = make_data()
    data["beer"] = [{"id": "ipa", "name": "Subversive IPA", "theoretical": 100000, "actual": 115000, "costPerBase": 0.0024, "pricePerBase": 0.017, "days": 14}]
    out = feed.pour_yield(data, {})
    assert out and "15% faster" in out[0]["title"]
    data["beer"][0]["actual"] = 104000  # within normal foam loss
    assert feed.pour_yield(data, {}) == []


def test_mix_shift_detects_trend_and_its_cost():
    data = make_data()
    # Hot chicken (lower margin than burger) steadily takes share from the burger.
    burger = next(i for i in data["items"] if i["id"] == "burger")
    chx = next(i for i in data["items"] if i["id"] == "chx")
    for n, k in enumerate(sorted(burger["daily"])):
        moved = min(burger["daily"][k][0] - 1, n * 0.25)
        burger["daily"][k] = [burger["daily"][k][0] - moved, (burger["daily"][k][0] - moved) * 19]
        chx["daily"][k] = [chx["daily"][k][0] + moved, (chx["daily"][k][0] + moved) * 18]
    ctx = {"menu": menu.run(data, price.run(data))}
    out = feed.mix_shift(data, ctx)
    assert any(o["subject"] == "chx" and "costs" in o["title"] for o in out), [o["title"] for o in out]


def test_labor_week_overtime_and_overscheduled():
    data = make_data()
    data["schedule"] = {"weekStart": "2026-11-16", "people": [{"name": "Jamie", "hours": 44, "rate": 18}, {"name": "Sam", "hours": 30, "rate": 16}], "forecastSales": 14000, "cost": 4600, "laborTarget": 0.26, "avgRate": 18}
    out = feed.labor_week(data, {})
    ot = next(o for o in out if o["kind"] == "feed.overtime")
    assert "Jamie" in ot["title"] and abs(ot["oneOff"] - 4 * 18 * 0.5 * 1.1) < 0.01
    assert any(o["kind"] == "feed.schedule" for o in out)


def test_inventory_cash():
    data = make_data()
    data["inventory"] = [{"name": "Flour", "category": "Pantry", "onHandValue": 900, "dailyUsageValue": 30}, {"name": "Lettuce", "category": "Produce", "onHandValue": 60, "dailyUsageValue": 20}]
    out = feed.inventory_cash(data, {})
    assert len(out) == 1 and out[0]["subject"] == "pantry" and abs(out[0]["oneOff"] - (900 - 14 * 30)) < 0.01


def test_weather_effect_recovered():
    data = make_data(rain_effect=-0.18, seed=5)
    st = staffing.run(data)["details"]
    out = feed.weather(data, {"splh": st["splh"], "wage": st["wage"]})
    assert out and "Rainy days run" in out[0]["title"]
    pct = int(out[0]["title"].split("run ")[1].split("%")[0])
    assert 10 <= pct <= 26


def test_weather_silent_without_effect():
    data = make_data(rain_effect=0.0, seed=8)
    st = staffing.run(data)["details"]
    assert feed.weather(data, {"splh": st["splh"], "wage": st["wage"]}) == []


def test_reviews_ops_links_complaints_to_lean_days():
    data = make_data()
    open_days = [x for x in data["days"] if x["open"]]
    lean = open_days[-3:]
    for x in lean:
        x["laborHours"] = x["laborHours"] * 0.7
    data["reviews"] = [{"date": x["date"], "rating": 2, "themes": ["wait", "staff"]} for x in lean]
    out = feed.reviews_ops(data, {})
    assert out and out[0]["title"].startswith("3 of 3")


def test_follow_through_measures_a_price_change():
    data = make_data(elasticity=-0.5, change_day=35)
    ctx = {"price": price.run(data)}
    out = feed.follow_through(data, ctx)
    f = next(o for o in out if o["subject"] == "pretzel" and o["kind"] == "feed.follow")
    assert "Since raising the Pretzel $1.00" in f["title"] and f["title"].split(": ")[1].startswith("+")


def test_feed_run_isolates_failures():
    data = make_data()
    data["priceHistory"] = "garbage"
    out = feed.run(data, {})
    assert any(e.startswith("price_creep") for e in out["errors"])
    assert isinstance(out["items"], list)
