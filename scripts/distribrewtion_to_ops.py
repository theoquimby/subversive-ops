"""
Turn a Distribrewtion export (docs/distribrewtion-export.js, or the file saved
from the logged-in app) into files the Ops keg import reads as they are
(Kegs -> Import, JSON).

The export links everything by internal id; the Ops importer matches on names
and reads plain words. This script resolves the ids and writes one JSON file
per part, each shaped { beers, batches, accounts, kegs, history }:

    python -I scripts/distribrewtion_to_ops.py <export.json> <out-dir> [kegs-per-part] [first-part-kegs]

Part 1 carries every beer, batch and account plus the first few kegs; later
parts carry the rest of the kegs with their history. Import the parts in
order. Re-running is safe: kegs match on their Distribrewtion id, history rows
on a stable key. Keep the wording below stable, since that key includes it.

How Distribrewtion's statuses are read:
  UNCLAIMED            -> Created
  FILLED               -> Filled (beer, batch)
  DELIVERED, own site  -> Stored (it went to our own taproom, it didn't leave)
  DELIVERED, a buyer   -> Delivered (out to that account)
  ON_TAP, own site     -> Tapped
  DIRTY                -> Returned (back, needs cleaning)
  CLEAN                -> Cleaned
  SHIPPED / IN_LIMBO / on tap or empty at a buyer -> a note, no state change
A repeat scan (delivered twice to the same place, tapped twice) becomes
"Moved", so beer tax doesn't count the same keg leaving twice.
"""

import collections
import json
import os
import sys

SIZE = {"HALF_BARREL": "1/2 bbl", "SIXTH_BARREL": "1/6 bbl", "QUARTER_BARREL": "1/4 bbl"}
KIND = {"BAR": "Bar", "RESTAURANT": "Restaurant", "GROCERY_STORE": "Shop", "OTHER": "Other"}
OWN_AREA = "Taproom"


def main(src, out_dir, per_part=40, first_part=3):
    d = json.load(open(src, encoding="utf-8"))
    own_name = (d.get("participant") or {}).get("name", "")
    loc = {l["id"]: l for l in d["locations"]}
    # Our own taproom is the site named like the brewery; any other "site" is a bucket (e.g. "Sold Wholesale Kegs").
    own = {l["id"] for l in d["locations"] if l.get("role") == "SITE" and l["name"].strip().lower() == own_name.strip().lower()}
    if not own:
        sys.exit("Couldn't tell which location is our own taproom.")
    bev = {b["id"]: b for b in d["beverages"] + d.get("beveragesArchived", [])}
    users = {m["user"]["id"]: m["user"] for m in d.get("members", [])}
    users.update({u["id"]: u for u in d.get("extraUsers", [])})

    def user_name(uid):
        u = users.get(uid) or {}
        return (u.get("name") or " ".join(x for x in [u.get("firstName"), u.get("lastName")] if x)).strip() or None

    def beer_name(bid):
        return bev[bid]["name"].strip() if bid in bev else None

    def acct_name(lid):
        return loc[lid]["name"].strip() if lid in loc else None

    # Batch names repeat across beers ("Batch 1"); Ops matches batches on their code, so make each one unique.
    batches = [b["batch"] for b in d["batches"]]
    seen = collections.Counter(b["name"].strip().lower() for b in batches)
    batch_code, used = {}, set()
    for b in sorted(batches, key=lambda b: b.get("createdAt") or ""):
        code = b["name"].strip()
        if seen[code.lower()] > 1:
            code = f"{code} · {beer_name(b['beverageId']) or 'unknown beer'}"
        if code.lower() in used:
            code = f"{code} · {(b.get('productionDateTime') or b.get('createdAt') or '')[:10]}"
        used.add(code.lower())
        batch_code[b["id"]] = code

    out_beers = [{
        "Name": b["name"].strip(),
        "Style": ((b.get("beverageStyle") or {}).get("name") or "").strip() or None,
        "ABV": b.get("abvRecipe"),
        "Notes": (b.get("description") or "").strip() or None,
    } for b in d["beverages"] + d.get("beveragesArchived", [])]

    out_batches = [{
        "Code": batch_code[b["id"]],
        "Beer": beer_name(b["beverageId"]),
        "Brew date": (b.get("productionDateTime") or "")[:10] or None,
        "Notes": " · ".join(x for x in [(b.get("notes") or "").strip(), f"ABV {b['abvBatch']}" if b.get("abvBatch") is not None else ""] if x) or None,
        "Dbt label": b["name"].strip(),
    } for b in batches]

    out_accounts, names = [], set()
    for l in d["locations"]:
        n = l["name"].strip()
        if n.lower() in names:
            continue
        names.add(n.lower())
        place = l.get("publicBusinessProfilePlace") or l.get("deliveryAddressPlace") or {}
        bucket = l.get("role") == "SITE" and l["id"] not in own
        out_accounts.append({
            "Name": n,
            "Type": "Taproom" if l["id"] in own else "Other" if bucket else KIND.get(l.get("classification") or "", "Bar"),
            "Address": place.get("address"),
            "Phone": (place.get("phoneNumber") or {}).get("number"),
            "Notes": "Distribrewtion's bucket for kegs sold wholesale with no buyer recorded." if bucket else None,
        })

    by_keg = collections.defaultdict(list)
    for u in d["kegHistories"]:
        by_keg[u["kegId"]].append(u)

    stats = collections.Counter()
    out_kegs, out_events = {}, {}
    for k in d["kegs"]:
        kid = k["id"]
        ups = sorted(by_keg.get(kid, []), key=lambda u: u["updatedAt"])
        rows, where = [], None  # where: None | "stored" | "tap" | ("out", account)
        for u in ups:
            t = u["type"].replace("STATUS_", "")
            buyer = u.get("buyerId")
            mine = buyer in own
            action, account, area, note = None, None, None, None
            beer = beer_name(u.get("beverageId"))
            batch = batch_code.get(u.get("batchId"))
            if t == "UNCLAIMED":
                action, note = "Created", "Tag registered in Distribrewtion"
            elif t == "FILLED":
                action, where = "Filled", None
            elif t == "CLEAN":
                action, where = "Cleaned", None
            elif t == "DIRTY":
                action, note, where = "Returned", "Marked dirty", None
            elif t == "DELIVERED" and mine:
                area = OWN_AREA
                if where == "tap":
                    action, note = "Moved", "Off tap, scanned as delivered to the taproom"
                elif where == "stored":
                    action, note = "Moved", "Scanned as delivered to the taproom again"
                else:
                    action = "Stored"
                where = "stored"
            elif t == "DELIVERED":
                account = acct_name(buyer)
                if isinstance(where, tuple) and where[1] == account:
                    action, note = "Moved", "Scanned as delivered again"
                elif isinstance(where, tuple):
                    action, note = "Moved", f"Moved on from {where[1]}"
                else:
                    action = "Delivered"
                where = ("out", account)
            elif t == "ON_TAP" and mine:
                area = OWN_AREA
                if where == "tap":
                    action, note = "Moved", "Scanned on tap again"
                else:
                    action = "Tapped"
                where = "tap"
            elif t == "ON_TAP":
                account = acct_name(buyer)
                if isinstance(where, tuple):
                    action = "Pouring at account"
                else:
                    action, note, where = "Delivered", "On tap at the account, no delivery scan", ("out", account)
            elif t == "EMPTY" and mine and where == "tap":
                action, area, where = "Kicked", OWN_AREA, None
            elif t == "EMPTY":
                account = None if mine else acct_name(buyer)
                action = "Finished" if mine else "Finished at account"
            elif t == "SHIPPED":
                action = "In transit"
            elif t == "IN_LIMBO":
                action = "In limbo"
            else:
                action = t.replace("_", " ").title()
            stats[f"{t} -> {action}"] += 1
            rows.append({
                "Keg code": kid, "Date": u["updatedAt"], "Action": action, "Beer": beer, "Batch": batch,
                "Account": account, "Location": area, "User": user_name(u.get("updatedBy")), "Notes": note,
                "Dbt was": t, "Dbt entry": u.get("entryMode"),
            })
        out_events[kid] = rows

        st = k["status"]
        mine = k.get("buyerId") in own
        real = [u for u in ups if u["type"] != "STATUS_IN_LIMBO"]
        last = real[-1] if real else None
        notes, active, account = [], "yes", None
        if st == "IN_LIMBO":
            # Distribrewtion lost track of it. Keep what it last was, off the boards until someone scans it.
            active = "no"
            limbo = [u for u in ups if u["type"] == "STATUS_IN_LIMBO"]
            notes.append(f"In limbo in Distribrewtion since {limbo[-1]['updatedAt'][:10]}" if limbo else "In limbo in Distribrewtion")
            src_k, st = (last or k), (last["type"].replace("STATUS_", "") if last else "CLEAN")
            mine = src_k.get("buyerId") in own
        else:
            src_k = k
        if st == "FILLED":
            status = "Filled"
        elif st == "CLEAN" or st == "UNCLAIMED":
            status = "Clean"
        elif st == "DIRTY":
            status = "Dirty"
        elif st in ("DELIVERED", "SHIPPED"):
            status = "Cold storage" if mine else "Out at account"
        elif st == "ON_TAP":
            status = "On tap" if mine else "Out at account"
            notes.append("On tap; Distribrewtion doesn't record the tap line" if mine else "On tap at the account")
        elif st == "EMPTY":
            status = "Kicked" if mine else "Out at account"
            if not mine:
                notes.append("Empty at the account, waiting to come back")
        else:
            status = "Clean"
        full = status in ("Filled", "Cold storage", "On tap", "Out at account")
        if status == "Out at account":
            account = acct_name(src_k.get("buyerId"))
        filled = [u for u in ups if u["type"] == "STATUS_FILLED"]
        stats[f"keg {k['status']} -> {status}{'' if active == 'yes' else ' (retired)'}"] += 1
        out_kegs[kid] = {
            "Keg code": kid, "Size": SIZE.get(k.get("size"), k.get("size")), "Status": status,
            "Beer": beer_name(src_k.get("beverageId")) if full else None,
            "Batch": batch_code.get(src_k.get("batchId")) if full else None,
            "Fill date": filled[-1]["updatedAt"][:10] if full and filled and ups.index(filled[-1]) >= max([ups.index(u) for u in ups if u["type"] in ("STATUS_CLEAN", "STATUS_DIRTY")] or [-1]) else None,
            "Account": account, "Notes": " · ".join(notes) or None, "Active": active,
            "Dbt was": k["status"], "Dbt seen": k.get("updatedAt"),
        }

    # Parts: a few kegs first (a check before the bulk), then the rest. Busiest-first inside the first part
    # would hide problems, so the first part takes ordinary kegs with a full, varied history.
    def variety(kid):
        return len({r["Action"] for r in out_events[kid]})
    ordinary = [k["id"] for k in d["kegs"] if k["status"] in ("FILLED", "DELIVERED", "DIRTY", "CLEAN")]
    first = sorted(ordinary, key=lambda kid: (-variety(kid), kid))[:first_part]
    rest = [k["id"] for k in d["kegs"] if k["id"] not in first]
    parts = [first] + [rest[i:i + per_part] for i in range(0, len(rest), per_part)]

    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.startswith("dbt-part-") and old.endswith(".json"):
            os.remove(os.path.join(out_dir, old))
    for i, ids in enumerate(parts, 1):
        body = {
            "beers": out_beers if i == 1 else [],
            "batches": out_batches if i == 1 else [],
            "accounts": out_accounts if i == 1 else [],
            "kegs": [out_kegs[kid] for kid in ids],
            "history": [r for kid in ids for r in out_events[kid]],
        }
        path = os.path.join(out_dir, f"dbt-part-{i:02d}.json")
        json.dump({k: v for k, v in body.items() if v}, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"{os.path.basename(path)}: {len(body['kegs'])} kegs, {len(body['history'])} history rows, {os.path.getsize(path) // 1024} KB")

    print(f"\n{len(out_beers)} beers, {len(out_batches)} batches, {len(out_accounts)} accounts, {len(out_kegs)} kegs, {sum(len(v) for v in out_events.values())} history rows")
    for key, n in sorted(stats.items()):
        print(f"  {n:5d}  {key}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], *(int(x) for x in sys.argv[3:5]))
