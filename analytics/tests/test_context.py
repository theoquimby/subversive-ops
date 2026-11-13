"""Context-aware findings: every model judges an item, an hour or a day relative to the business
(traffic, weekday mix, season, holidays, events), and explains itself in an evidence block.

The key synthetic cases: traffic falls but the item holds its share → must NOT be flagged;
the item truly drops → must be flagged."""

import json
import math
import re
from datetime import date, timedelta

import numpy as np

from conftest import make_data
from subops import anomalies, feed, followup, menu, price, staffing
from subops.common import prepare, same_product, trim_renamed
from subops.context import DayContext, bootstrap_weeks, day_context, holiday, standardized_rate
from subops.engine import analyze

AS_OF = "2026-11-13"
CHANGE = "2026-09-14"  # a Monday, clear of Labor Day
WD = {0: 0.7, 1: 0.0, 2: 0.75, 3: 0.85, 4: 1.2, 5: 1.5, 6: 1.1}
JARGON = ("elasticity", "regression", "z-score", "bootstrap", "difference-in-differences", "p-value", "standard error", "coefficient", "splh")


def world(seed=1, traffic_after=1.0, effect=0.0, item_season_drop=0.0, subst=0.0, delay_weeks=0, years=3, change=CHANGE, base_rate=0.08, siblings=3):
    """Days, orders and a beer category. The Lager's price goes $7.50 → $8 on `change`.
    traffic_after: orders multiplier after the change (this year only).
    effect: the true price effect on Lager per order (−0.25 = 25% fewer per guest).
    item_season_drop: every year, the Lager's share drops this much from mid-September (season, not price).
    subst: share of the Lager's lost sales that go to the other beers.
    delay_weeks: the drop starts this many weeks after the change (not a price effect)."""
    rng = np.random.default_rng(seed)
    end = date.fromisoformat(AS_OF)
    start = end - timedelta(days=int(365.25 * years))
    chg = date.fromisoformat(change)
    days, lager_d, sib_d = [], {}, {f"s{i}": {} for i in range(siblings)}
    for i in range((end - start).days):
        dt = start + timedelta(days=i)
        k = dt.isoformat()
        m = WD[dt.weekday()]
        if m == 0:
            days.append({"date": k, "open": False, "sales": 0, "orders": 0})
            continue
        doy = dt.timetuple().tm_yday
        season = 1 + 0.25 * math.sin(2 * math.pi * (doy - 120) / 365.25)
        after = dt >= chg
        orders = 90 * m * season * math.exp(rng.normal(0, 0.08)) * (traffic_after if after else 1.0)
        # Every year the Lager's share eases from mid-September (people move to darker beers).
        in_fall = (dt.month == 9 and dt.day >= 14) or dt.month in (10, 11)
        share = base_rate * ((1 - item_season_drop) if in_fall else 1.0)
        eff_on = after and dt >= chg + timedelta(weeks=delay_weeks)
        lost = share * (-effect) if eff_on else 0.0
        q = rng.poisson(orders * (share + (effect * share if eff_on else 0.0)))
        price = 8.0 if after else 7.5
        lager_d[k] = [float(q), float(q * price)]
        for s in sib_d:
            qs = rng.poisson(orders * (0.06 + subst * lost / siblings))
            sib_d[s][k] = [float(qs), float(qs * 8.0)]
        sales = orders * 32
        days.append({"date": k, "open": True, "sales": sales, "orders": orders, "labor": 200 + 0.2 * sales, "laborHours": 10 + sales / 150, "cogs": 0, "foodSales": 0})

    def split(series):
        daily = {k: v for k, v in series.items() if k >= (end - timedelta(days=120)).isoformat() and v[0] > 0}
        weekly = {}
        for k, v in series.items():
            d0 = date.fromisoformat(k)
            w = (d0 - timedelta(days=d0.weekday())).isoformat()
            cur = weekly.setdefault(w, [0.0, 0.0])
            cur[0] += v[0]
            cur[1] += v[1]
        return daily, weekly

    ld, lw = split(lager_d)
    items = [{"id": "lager", "name": "Hoppy Lager · Full Pour", "category": "Beer For Here", "group": "beverage", "kind": "MENU", "price": 8.0, "unitCost": None, "linked": False, "daily": ld, "weekly": lw}]
    for s, ser in sib_d.items():
        d_, w_ = split(ser)
        items.append({"id": s, "name": f"Beer {s} · Full Pour", "category": "Beer For Here", "group": "beverage", "kind": "MENU", "price": 8.0, "unitCost": None, "linked": False, "daily": d_, "weekly": w_})
    return {"asOf": AS_OF, "days": days, "items": items, "hourly": [], "future": [], "minCrew": 2}


def measure(data, **kw):
    prepare(data)
    lager = data["items"][0]
    return followup.measure(data, lager, kw.get("start", CHANGE), 7.5, 8.0, data["items"][1:])


# ---- Price follow-ups ----------------------------------------------------------------------


def test_traffic_falls_but_item_holds_share_is_not_flagged():
    data = world(traffic_after=0.72, effect=0.0)
    m = measure(data)
    assert m["status"] == "ok"
    assert m["rawUnits"] < -0.15  # raw counts fell a lot …
    assert abs(m["effect"]) < 0.12 and not m["clear"]  # … but relative to traffic, nothing happened
    o = followup.describe(data, data["items"][0], CHANGE, 7.5, 8.0, m)
    assert o["status"] == "watching" and o["kind"] == "feed.follow.watch"
    assert "Relative to how busy you were" in o["evidence"]["summary"]
    assert o["evidence"]["verdict"] == "unclear" and o["evidence"]["watch"]
    assert o["monthly"] == 0


def test_item_that_truly_drops_is_flagged_with_a_range():
    data = world(traffic_after=1.0, effect=-0.3)
    m = measure(data)
    assert m["clear"]
    assert -0.45 < m["effect"] < -0.15
    assert m["effectLow"] < m["effect"] < m["effectHigh"] < 0
    o = followup.describe(data, data["items"][0], CHANGE, 7.5, 8.0, m)
    assert o["kind"] == "feed.follow" and "−" in o["title"] and "for how busy you were" in o["title"]
    ev = o["evidence"]
    assert ev["verdict"] == "real" and ev["effect"]["high"] < 0
    labels = [r["label"] for r in ev["rows"]]
    assert any("Orders per open day" in x for x in labels) and any("per 100 orders" in x for x in labels)
    assert ev["chart"]["type"] == "series" and ev["chart"]["points"]
    assert ev["method"] and ev["sure"].startswith(("Pretty sure", "Fairly sure"))


def test_drop_with_falling_traffic_is_still_found():
    data = world(traffic_after=0.75, effect=-0.3, seed=3)
    m = measure(data)
    assert m["clear"] and -0.45 < m["effect"] < -0.15


def test_seasonal_drop_every_autumn_is_not_blamed_on_the_price():
    data = world(effect=0.0, item_season_drop=0.25, seed=4)
    m = measure(data)
    assert m["itemChange"] < -0.12  # its share really fell …
    assert m["control"]["kind"] == "lastYear"  # … just like the same weeks in earlier years
    assert not m["clear"]


def test_category_stands_in_when_there_is_no_last_year():
    data = world(effect=0.0, item_season_drop=0.0, years=0.4, seed=5)
    m = measure(data)
    assert m["control"] and m["control"]["kind"] == "category"
    assert not m["clear"]


def test_substitution_counts_back_what_the_other_beers_picked_up():
    data = world(effect=-0.4, subst=1.0, seed=6, base_rate=0.12, siblings=2)
    m = measure(data)
    assert m["clear"] and m["subst"] and m["subst"]["clear"]
    assert m["subst"]["share"] > 0.4
    assert m["netMonthly"] > m["monthly"]  # the loss to the business is smaller than the loss on the item


def test_a_drop_that_starts_weeks_later_is_not_pinned_on_the_price():
    data = world(effect=-0.7, delay_weeks=3, seed=8, base_rate=0.15)
    m = measure(data)
    assert not m["clear"] and m["reason"] == "timing"
    o = followup.describe(data, data["items"][0], CHANGE, 7.5, 8.0, m)
    assert o["status"] == "watching" and "timing" in o["title"]


def test_price_rise_that_sells_more_is_not_credited_with_the_volume():
    data = world(effect=0.5, seed=8)
    m = measure(data)
    assert m["implausible"]
    o = followup.describe(data, data["items"][0], CHANGE, 7.5, 8.0, m)
    assert "held up" in o["title"]
    # Only the extra 50¢ on what was sold: about units a day × $0.50 × open days a month.
    assert 0 < o["monthly"] < m["units"][1] * 0.5 * 27


def test_event_days_holidays_and_86d_days_are_left_out():
    data = world(effect=-0.3, seed=9)
    for x in data["days"]:
        if x["date"] == "2026-09-26":
            x.update({"eventKinds": ["GAME"], "eventTitles": ["Knicks game"], "eventMult": 1.4})
    for k in ("2026-10-01", "2026-10-02", "2026-10-03"):
        data["items"][0]["daily"].pop(k, None)  # keg kicked
    m = measure(data, start="2026-09-07")  # Labor Day is the change day
    text = " ".join(m["excluded"])
    assert "Labor Day" in text and "event" in text
    assert set(m["unavailable"]) >= {"2026-10-02", "2026-10-03"}


def test_follow_through_end_to_end_splits_watching_from_findings():
    data = world(traffic_after=0.72, effect=0.0, seed=10)
    prepare(data)
    ctx = {"price": price.run(data)}
    out = feed.run(data, ctx)
    assert not any(o["kind"] == "feed.follow" and o["subject"] == "lager" for o in out["items"])
    w = [o for o in out["watching"] if o["subject"] == "lager"]
    assert w and w[0]["evidence"]["verdict"] == "unclear"
    data2 = world(effect=-0.35, seed=11)
    prepare(data2)
    out2 = feed.run(data2, {"price": price.run(data2)})
    assert any(o["kind"] == "feed.follow" and o["subject"] == "lager" for o in out2["items"])


def test_product_swap_under_the_same_button_is_not_a_price_change():
    data = world(effect=0.0, seed=12)
    prepare(data)
    lager = data["items"][0]
    for k, v in lager["daily"].items():
        if k >= CHANGE:
            v[1] = v[0] * 12.0  # $7.50 → $12: a different size, not a price rise
    ctx = {"price": {"details": {"items": [{"id": "lager", "name": lager["name"], "changes": [{"date": CHANGE, "from": 7.5, "to": 12.0}]}]}}}
    assert not [o for o in feed.follow_through(data, ctx) if o["subject"] == "lager"]


# ---- Helpers ----------------------------------------------------------------------------------


def test_holidays_and_fair_days():
    assert holiday("2026-09-07") == "Labor Day"
    assert holiday("2026-11-26") == "Thanksgiving"
    assert holiday("2026-04-05") == "Easter"
    assert holiday("2026-09-08") is None
    data = make_data()
    ctx = day_context(data)
    ev = next(x["date"] for x in data["days"] if x.get("eventKinds"))
    assert ctx.special(ev) == "event"


def test_weekday_mix_is_held_fixed():
    # Same rate every weekday, but the 'after' period is all Mondays (low orders): no change.
    a = [(0, 5.0, 50.0), (5, 15.0, 150.0)]
    b = [(0, 5.0, 50.0), (0, 5.0, 50.0), (5, 15.0, 150.0)]
    ra, rb, wds = standardized_rate(a, b)
    assert wds == [0, 5] and abs(ra - rb) < 1e-12
    sa, sb = bootstrap_weeks([("w1", 0, 5.0, 50.0), ("w1", 5, 15.0, 150.0)], [("w2", 0, 5.0, 50.0), ("w2", 5, 15.0, 150.0)], 50)
    assert np.allclose(sa, sb)


def test_renamed_button_history_is_trimmed():
    assert same_product("House Smoked Pulled Pork", "House Smoked Pulled Pork Sandwich")
    assert not same_product("Chicken Club Sandwich Special", "House Smoked Pulled Pork Sandwich")
    it = {"name": "House Smoked Pulled Pork Sandwich", "names": [{"name": "Kimchi + Brisket Reuben", "from": "2022-11-10", "to": "2022-11-12"}, {"name": "House Smoked Pulled Pork", "from": "2023-05-25", "to": "2023-09-10"}, {"name": "House Smoked Pulled Pork Sandwich", "from": "2024-01-05", "to": "2025-07-06"}], "weekly": {"2022-11-07": [20, 360], "2023-05-22": [10, 160], "2024-01-01": [9, 150]}}
    assert trim_renamed([it]) == 1
    assert "2022-11-07" not in it["weekly"] and "2023-05-22" in it["weekly"]


# ---- Price tries ------------------------------------------------------------------------------


def test_pooling_borrows_from_similar_items_but_stays_anchored():
    fits = [{"category": "beer", "fit": {"raw": -0.1, "se": 0.1}} for _ in range(8)] + [{"category": "beer", "fit": None}]
    g = price.pool(fits)["beer"]
    pm, _ = price.PRIORS["beer"]
    assert pm < g["mean"] < -0.1  # pulled toward the (less price-sensitive) measured items, but not all the way
    assert g["n"] == 8


def test_price_try_needs_recent_sales_and_says_why():
    data = make_data()
    r = price.run(data)
    assert all(o.get("evidence") and o["evidence"]["rows"] and o["evidence"]["sure"] for o in r["opportunities"])
    gone = dict(data["items"][0])
    gone.update({"id": "gone", "name": "Old special", "daily": {}, "weekly": {"2025-06-02": [50, 900]}})
    data["items"].append(gone)
    r = price.run(data)
    assert not any(x["id"] == "gone" for x in r["details"]["items"])


# ---- Staffing, slow days, unusual days, menu -------------------------------------------------


def test_staffing_leaves_out_holidays_and_explains_itself():
    data = make_data()
    data["openingHours"] = {str(k): [16, 23] for k in (0, 1, 3, 4, 5, 6)}
    for r in data["hourly"]:
        if date.fromisoformat(r["date"]).weekday() == 4 and r["hour"] in (17, 18):
            r["laborHours"], r["laborCost"] = r["laborHours"] + 3, r["laborCost"] + 60
    r = staffing.run(data)
    assert any("Knicks" in e or "event" in e for e in r["details"]["excluded"])
    fri = [o for o in r["opportunities"] if o["subject"].startswith("4.")]
    assert fri and fri[0]["evidence"]["verdict"] == "real"
    labels = " ".join(x["label"] for x in fri[0]["evidence"]["rows"])
    assert "other hours" in labels and "pace" in labels


def test_staffing_an_hour_staffed_like_other_quiet_hours_is_watched_not_flagged():
    data = make_data()
    data["openingHours"] = {str(k): [16, 23] for k in (0, 1, 3, 4, 5, 6)}
    # Every quiet hour across the week runs with 4 people: a habit, not one slot's problem.
    for r in data["hourly"]:
        if r["sales"] < 300:
            r["laborHours"], r["laborCost"] = 4.0, 80.0
    r = staffing.run(data)
    assert not r["opportunities"]
    assert all(w["status"] == "watching" and w["evidence"]["watch"] for w in r["watching"])


def test_slow_days_judged_against_the_time_of_year_and_what_was_foreseeable():
    from test_lab import years_of_days

    data = years_of_days(2)
    prepare(data)
    # Crew follows sales, winter is just quieter: nothing to flag.
    assert anomalies.slow_days(data) is None or anomalies.slow_days(data).get("status") == "watching"
    rng = np.random.default_rng(2)
    for x in data["days"][-180:]:
        if x["open"] and rng.random() < 0.2:
            x["sales"] *= 0.45  # a surprise slow day, crew stayed
    data.pop("_dayctx", None)
    sd = anomalies.slow_days(data)
    assert sd and sd["kind"] == "anomaly.slowdays"
    labels = [r["label"] for r in sd["evidence"]["rows"]]
    assert "Foreseeable a week ahead" in labels and "Hours we count" in labels
    # Surprises only count half: the counted hours are under the raw extra.
    assert sd["monthly"] < sd["high"] + 1e-6


def test_unusual_day_is_judged_against_that_date():
    from test_lab import years_of_days

    data = years_of_days(3)
    prepare(data)
    last = [x for x in data["days"] if x["open"]][-3]
    last["sales"] *= 0.35
    found = anomalies.scores(data["days"], data["asOf"], data)
    hit = next(a for a in found if a["date"] == last["date"] and a["metric"] == "sales")
    assert "expected" in hit["text"] and hit["evidence"]["rows"]
    # A normal winter day isn't unusual just because it's below the summer.
    assert not any(a["metric"] == "sales" and a["date"] != last["date"] and a["z"] < -3 for a in found)


def test_menu_judges_popularity_per_day_on_the_menu_and_within_category():
    data = make_data()
    # The pretzel only joined the menu 10 days ago but sells well per day.
    pre = data["items"][3]
    keep = sorted(pre["daily"])[-10:]
    pre["daily"] = {k: [20.0, 20.0 * 14] for k in keep}
    r = menu.run(data)
    row = next(x for x in r["details"]["rows"] if x["id"] == "pretzel")
    assert row["onDays"] <= 10 and row["perDay"] > 15
    assert row["cls"] in ("Star", "Workhorse")  # popular per day on the menu


# ---- Every finding explains itself ----------------------------------------------------------------


def _all_text(ev):
    out = [ev.get("summary", ""), ev.get("method", ""), ev.get("sure", ""), ev.get("watch") or ""] + ev.get("steps", []) + ev.get("excluded", [])
    for r in ev.get("rows", []):
        out += [r.get("label", ""), r.get("value", ""), r.get("note", "")]
    return " ".join(str(x) for x in out).lower()


def test_every_finding_carries_plain_english_evidence():
    data = world(effect=-0.3, seed=21)
    base = make_data()
    data["hourly"] = base["hourly"]
    out = analyze({"data": data, "models": None})
    json.dumps(out)
    found = 0
    for k, r in out["results"].items():
        items = r.get("items", []) if k == "feed" else r.get("opportunities", [])
        assert "watching" in r
        for o in items + r.get("watching", []):
            ev = o.get("evidence")
            assert ev and ev["method"] is not None and ev["sure"], (k, o["key"])
            text = _all_text(ev)
            assert not any(re.search(rf"\b{re.escape(j)}\b", text) for j in JARGON), (o["key"], text)
            found += 1
    assert found > 0
    assert out["version"] >= "2.1.0"
