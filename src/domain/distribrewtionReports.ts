/**
 * Distribrewtion's "Consumed Volume" reports (Reports → Consumed Volume →
 * by Beverage / by Buyer / Totals, exported as CSV). They aren't one row per
 * record: a few "Key,Value" lines of report details, a blank line, then a
 * small table. This turns them into ordinary import sources:
 *
 *   by Beverage → beers   (name + lifetime barrels)
 *   by Buyer    → accounts (name + lifetime barrels, top beers)
 *   Totals      → a summary source the import skips (taproom / distributed split)
 *
 * Pure: no I/O. Returns null for anything that isn't one of these reports.
 */

import { splitCsv } from "./bulkImport";
import type { RawRecord, RawSource } from "./kegImport";

const round = (n: number) => Math.round(n * 100) / 100;
const num = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};
/** Rows Distribrewtion uses for things that aren't a real beer or customer. */
const NOT_A_NAME = /^(unknown|all buyers|all beverages|total)$/i;

export interface VolumeReportInfo {
  kind: "beverage" | "buyer" | "totals";
  from: string | null;
  to: string | null;
  units: string;
}

export function parseConsumedVolume(text: string, fileName: string): { sources: RawSource[]; info: VolumeReportInfo } | null {
  const clean = text.replace(/^﻿/, "");
  if (!/^\s*Consumed Volume Report/i.test(clean)) return null;
  const rows = clean.replace(/\r/g, "").split("\n").map((l) => splitCsv(l).map((c) => c.trim()));
  const meta = new Map<string, string>();
  let start = -1;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some(Boolean)) continue;
    if (/^(beverages|total volume)$/i.test(r[0]) || (r[0] === "" && r.length > 2 && /all beverages/i.test(r[1] ?? ""))) {
      start = i;
      break;
    }
    if (r[0] && r.length >= 2) meta.set(r[0].toLowerCase(), r[1]);
  }
  if (start < 0) return null;
  const header = rows[start];
  const body = rows.slice(start + 1).filter((r) => r.some(Boolean));
  const units = meta.get("units") ?? "Barrels";
  const toBbl = (n: number) => (/gallon/i.test(units) ? n / 31 : n);
  const info = { from: meta.get("start date") ?? null, to: meta.get("end date") ?? null, units };
  const period = info.from && info.to ? `${info.from} – ${info.to}` : null;
  const base = fileName.replace(/\.csv$/i, "");

  if (/^beverages$/i.test(header[0])) {
    const records: RawRecord[] = body
      .filter((r) => r[0] && !NOT_A_NAME.test(r[0]))
      .map((r) => ({ Name: r[0], "Barrels sold (Distribrewtion)": round(toBbl(num(r[1]))), "Report period": period }));
    return { sources: [{ name: `${base} · Beers`, records }], info: { kind: "beverage", ...info } };
  }

  if (/^total volume$/i.test(header[0])) {
    const records: RawRecord[] = body.map((r) => ({ Channel: r[0], Barrels: round(toBbl(num(r[1]))), "Report period": period }));
    return { sources: [{ name: `${base} · Totals (summary only)`, records }], info: { kind: "totals", ...info } };
  }

  // By buyer: first column buyer, then "All Beverages", then one column per beer.
  const beers = header.slice(2);
  const records: RawRecord[] = [];
  for (const r of body) {
    const name = r[0];
    if (!name || NOT_A_NAME.test(name)) continue;
    // "Sold Wholesale Kegs" is a bucket, not a customer.
    if (/^sold wholesale kegs$/i.test(name)) continue;
    const total = round(toBbl(num(r[1])));
    const top = beers
      .map((b, i) => ({ b, v: toBbl(num(r[i + 2])) }))
      .filter((x) => x.v > 0 && !NOT_A_NAME.test(x.b))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5)
      .map((x) => `${x.b} ${round(x.v)}`)
      .join(", ");
    records.push({
      Name: name,
      Type: /subversive/i.test(name) ? "Taproom" : "Bar",
      Notes: `Distribrewtion: ${total} bbl${period ? ` (${period})` : ""}${top ? ` · top: ${top}` : ""}`,
      "Barrels bought (Distribrewtion)": total,
    });
  }
  return { sources: [{ name: `${base} · Accounts`, records }], info: { kind: "buyer", ...info } };
}
