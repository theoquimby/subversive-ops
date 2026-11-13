import "server-only";
import { Prisma } from "@prisma/client";
import { detectEntity, fillsFromHistory, headersOf, legacyKey, planKegImport, stableHash, type EntityOrSkip, type ImportPlan, type Mapping, type RawRecord, type RawSource } from "@/domain/kegImport";
import { guessBeerColor, placeLabel } from "@/domain/kegs";
import { db } from "../db";
import { readTables } from "./priceImport";
import { freshCodes } from "./kegs";

/**
 * Importing from the old keg app. Uploads are parsed here and parked in a
 * Setting row (`kegs.import.upload.<id>`) so the browser only ever handles
 * headers and a few sample rows, however long the history is. The manager
 * confirms what each file is and which column is which; the pure mapper
 * (domain/kegImport) builds the plan; `applyKegImport` saves it.
 *
 * The same `RawSource[]` shape is what a future API pull from the old app
 * will produce, so it can reuse everything after `parkSources`.
 */

const UPLOAD_PREFIX = "kegs.import.upload.";
const MAPPINGS_KEY = "kegs.import.mappings";
const MAX_RECORDS = 200_000;

export interface SourceInfo {
  index: number;
  name: string;
  rows: number;
  headers: string[];
  sample: RawRecord[];
  entity: EntityOrSkip;
  mapping: Mapping;
  /** The mapping came from a previous import of a file with the same columns. */
  remembered: boolean;
}

const signature = (headers: string[]) => stableHash([...headers].sort().join("|"));

/** Files (CSV, XLSX with any number of tabs, JSON from an API) → raw sources. */
export async function readSourcesFromFile(file: File): Promise<RawSource[]> {
  const name = file.name;
  if (/\.json$/i.test(name) || file.type === "application/json") {
    if (file.size > 12 * 1024 * 1024) throw new Error("That file is over 12 MB.");
    let v: unknown;
    try {
      v = JSON.parse(await file.text());
    } catch {
      throw new Error(`${name} isn't valid JSON.`);
    }
    return jsonSources(name.replace(/\.json$/i, ""), v);
  }
  const tables = await readTables(file);
  const multi = tables.length > 1;
  return tables.map((t) => ({ name: multi ? `${name} · ${t.name}` : name, records: t.records }));
}

/** An API dump: an array of records, or an object whose array fields are entities ({ kegs: [...], customers: [...] }), or { data: [...] }. */
export function jsonSources(name: string, v: unknown): RawSource[] {
  if (Array.isArray(v)) return [{ name, records: v.filter((x) => x && typeof x === "object") as RawRecord[] }];
  if (v && typeof v === "object") {
    const out: RawSource[] = [];
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(x) && x.some((y) => y && typeof y === "object")) out.push({ name: k === "data" || k === "results" || k === "items" ? name : `${name} · ${k}`, records: x.filter((y) => y && typeof y === "object") as RawRecord[] });
    }
    if (out.length) return out;
  }
  throw new Error(`${name} has no list of records in it.`);
}

/** Park parsed sources for this upload and describe them (detected entity + remembered or guessed mapping). */
export async function parkSources(uploadId: string, sources: RawSource[]): Promise<SourceInfo[]> {
  const key = UPLOAD_PREFIX + uploadId;
  const existing = await loadSources(uploadId);
  const all = [...existing, ...sources.filter((s) => s.records.length)];
  if (all.reduce((s, x) => s + x.records.length, 0) > MAX_RECORDS) throw new Error("That's more rows than one import takes (200,000). Import the history in parts.");
  const value = JSON.stringify(all);
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return describe(all);
}

async function loadSources(uploadId: string): Promise<RawSource[]> {
  if (!/^[a-z0-9-]{6,64}$/i.test(uploadId)) return [];
  const row = await db.setting.findUnique({ where: { key: UPLOAD_PREFIX + uploadId } });
  try {
    return row ? (JSON.parse(row.value) as RawSource[]) : [];
  } catch {
    return [];
  }
}

export async function discardUpload(uploadId: string) {
  await db.setting.deleteMany({ where: { key: UPLOAD_PREFIX + uploadId } });
}

async function describe(sources: RawSource[]): Promise<SourceInfo[]> {
  const remembered = await rememberedMappings();
  return sources.map((s, index) => {
    const headers = headersOf(s.records);
    const saved = remembered[signature(headers)];
    const det = detectEntity(s);
    const savedOk = saved && Object.values(saved.mapping).every((h) => !h || headers.includes(h));
    return {
      index,
      name: s.name,
      rows: s.records.length,
      headers,
      sample: s.records.slice(0, 3),
      entity: savedOk ? saved.entity : det.entity,
      mapping: savedOk ? saved.mapping : det.mapping,
      remembered: !!savedOk,
    };
  });
}

async function rememberedMappings(): Promise<Record<string, { entity: EntityOrSkip; mapping: Mapping }>> {
  const row = await db.setting.findUnique({ where: { key: MAPPINGS_KEY } });
  try {
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

export interface SpecChoice { index: number; entity: EntityOrSkip; mapping: Mapping }

export async function planFromUpload(uploadId: string, choices: SpecChoice[]): Promise<ImportPlan | { error: string }> {
  const sources = await loadSources(uploadId);
  if (!sources.length) return { error: "The upload expired. Add the files again." };
  const specs = choices.filter((c) => sources[c.index]).map((c) => ({ source: sources[c.index], entity: c.entity, mapping: c.mapping }));
  return planKegImport(specs);
}

/** Counts against what's already in the app, for the review step. */
export async function reviewCounts(plan: ImportPlan) {
  const [kegs, beers, accounts, events] = await Promise.all([
    db.keg.findMany({ where: { legacyCode: { not: null } }, select: { legacyCode: true } }),
    db.beer.findMany({ select: { name: true } }),
    db.kegAccount.findMany({ select: { name: true } }),
    plan.events.length ? db.kegEvent.count({ where: { importKey: { in: plan.events.slice(0, 20000).map((e) => e.importKey) } } }) : 0,
  ]);
  const legacy = new Set(kegs.map((k) => legacyKey(k.legacyCode!)));
  const bn = new Set(beers.map((b) => b.name.toLowerCase()));
  const an = new Set(accounts.map((a) => a.name.toLowerCase()));
  return {
    kegsNew: plan.kegs.filter((k) => !legacy.has(legacyKey(k.legacyCode))).length,
    kegsUpdated: plan.kegs.filter((k) => legacy.has(legacyKey(k.legacyCode))).length,
    beersNew: plan.beers.filter((b) => !bn.has(b.name.toLowerCase())).length,
    accountsNew: plan.accounts.filter((a) => !an.has(a.name.toLowerCase())).length,
    eventsNew: plan.events.length - events,
    eventsSeen: events,
  };
}

export interface ImportResult {
  kegsCreated: number;
  kegsUpdated: number;
  beers: number;
  accounts: number;
  batches: number;
  spots: number;
  events: number;
  fills: number;
}

const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const json = (v: RawRecord | null) => (v ? (v as Prisma.InputJsonValue) : Prisma.JsonNull);

/**
 * Save a plan. Every step matches what's there (kegs on their old code,
 * beers/accounts on name, batches on code, history on its importKey), so
 * running the same import twice changes nothing the second time.
 */
export async function applyKegImport(uploadId: string, choices: SpecChoice[], user: { userId: string; name: string }): Promise<ImportResult | { error: string }> {
  const plan = await planFromUpload(uploadId, choices);
  if ("error" in plan) return plan;
  const out: ImportResult = { kegsCreated: 0, kegsUpdated: 0, beers: 0, accounts: 0, batches: 0, spots: 0, events: 0, fills: 0 };

  // Beers
  const beerRows = await db.beer.findMany({ select: { id: true, name: true, squareNames: true, notes: true } });
  const beerId = new Map(beerRows.map((b) => [b.name.toLowerCase(), b.id]));
  for (const b of plan.beers) {
    const id = beerId.get(b.name.toLowerCase());
    if (id) {
      const cur = beerRows.find((x) => x.id === id)!;
      await db.beer.update({ where: { id }, data: { style: b.style ?? undefined, notes: cur.notes ?? b.notes ?? undefined, squareNames: b.squareName && !cur.squareNames.includes(b.squareName) ? { push: b.squareName } : undefined, extra: b.extra ? json(b.extra) : undefined } });
    } else {
      const created = await db.beer.create({ data: { name: b.name, style: b.style, color: guessBeerColor(`${b.name} ${b.style ?? ""}`), squareNames: b.squareName ? [b.squareName] : [], notes: b.notes, extra: json(b.extra) } });
      beerId.set(b.name.toLowerCase(), created.id);
      out.beers++;
    }
  }
  const beerOf = (n: string | null) => (n ? beerId.get(n.toLowerCase()) ?? null : null);

  // Accounts: fill in blanks, never overwrite what someone typed in the app.
  const accRows = await db.kegAccount.findMany();
  const accId = new Map(accRows.map((a) => [a.name.toLowerCase(), a.id]));
  for (const a of plan.accounts) {
    const cur = accRows.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
    if (cur) {
      await db.kegAccount.update({ where: { id: cur.id }, data: { contact: cur.contact ?? a.contact, email: cur.email ?? a.email, phone: cur.phone ?? a.phone, address: cur.address ?? a.address, notes: cur.notes ?? a.notes, kind: cur.kind === "bar" && a.kind !== "bar" ? a.kind : undefined, extra: a.extra ? json({ ...((cur.extra as RawRecord) ?? {}), ...a.extra }) : undefined } });
    } else {
      const created = await db.kegAccount.create({ data: { name: a.name, kind: a.kind, contact: a.contact, email: a.email, phone: a.phone, address: a.address, notes: a.notes, extra: json(a.extra) } });
      accId.set(a.name.toLowerCase(), created.id);
      out.accounts++;
    }
  }
  const accOf = (n: string | null) => (n ? accId.get(n.toLowerCase()) ?? null : null);

  // Batches
  const batchId = new Map((await db.kegBatch.findMany({ select: { id: true, code: true } })).map((b) => [b.code.toLowerCase(), b.id]));
  for (const b of plan.batches) {
    const id = batchId.get(b.code.toLowerCase());
    const data = { beerId: beerOf(b.beer), brewedOn: day(b.brewedOn), packagedOn: day(b.packagedOn), notes: b.notes };
    if (id) await db.kegBatch.update({ where: { id }, data: { ...Object.fromEntries(Object.entries(data).filter(([, v]) => v != null)), extra: b.extra ? json(b.extra) : undefined } });
    else { const c = await db.kegBatch.create({ data: { code: b.code, ...data, extra: json(b.extra) } }); batchId.set(b.code.toLowerCase(), c.id); out.batches++; }
  }
  const batchOf = async (code: string | null, beer: string | null) => {
    if (!code) return null;
    const id = batchId.get(code.toLowerCase());
    if (id) return id;
    const c = await db.kegBatch.create({ data: { code, beerId: beerOf(beer) } });
    batchId.set(code.toLowerCase(), c.id);
    out.batches++;
    return c.id;
  };

  // Spots
  const spotRows = await db.kegSpot.findMany();
  const spotId = new Map(spotRows.map((s) => [`${s.area.toLowerCase()}|${s.name.toLowerCase()}`, s.id]));
  for (const s of plan.spots.filter((x) => x.name)) {
    const k = `${s.area.toLowerCase()}|${s.name.toLowerCase()}`;
    if (spotId.has(k)) continue;
    const c = await db.kegSpot.create({ data: { area: s.area, name: s.name, sort: spotRows.length + out.spots } });
    spotId.set(k, c.id);
    out.spots++;
  }

  // Kegs, matched on the old sticker code.
  const existing = await db.keg.findMany({ where: { legacyCode: { not: null } }, select: { id: true, legacyCode: true } });
  const kegId = new Map(existing.map((k) => [legacyKey(k.legacyCode!), k.id]));
  const needCodes = plan.kegs.filter((k) => !kegId.has(legacyKey(k.legacyCode))).length;
  const codes = needCodes ? await freshCodes(needCodes) : [];
  for (const k of plan.kegs) {
    if (k.batch) await batchOf(k.batch, k.beer);
    const key = legacyKey(k.legacyCode);
    const id = kegId.get(key);
    const spot = k.area && k.spot ? spotId.get(`${k.area.toLowerCase()}|${k.spot.toLowerCase()}`) ?? null : null;
    const state = {
      ...(k.sizeId ? { sizeId: k.sizeId } : {}),
      ...(k.owner ? { owner: k.owner } : {}),
      ...(k.status ? { status: k.status, beerId: k.status === "EMPTY" || k.status === "CLEANING" ? null : beerOf(k.beer) } : k.beer ? { beerId: beerOf(k.beer) } : {}),
      ...(k.area ? { area: k.area, spotId: spot } : {}),
      ...(k.status === "ON_TAP" ? { tapLine: k.tapLine } : k.status ? { tapLine: null } : {}),
      ...(k.status === "OUT" ? { accountId: accOf(k.account) } : k.status ? { accountId: null } : {}),
      active: k.active,
    };
    if (id) {
      const cur = await db.keg.findUnique({ where: { id }, select: { notes: true, extra: true } });
      await db.keg.update({ where: { id }, data: { ...state, notes: cur?.notes ?? k.notes, extra: k.extra ? json({ ...((cur?.extra as RawRecord) ?? {}), ...k.extra }) : undefined } });
      out.kegsUpdated++;
    } else {
      const c = await db.keg.create({ data: { code: codes.pop()!, legacyCode: k.legacyCode, sizeId: k.sizeId ?? "half", owner: k.owner ?? "OURS", notes: k.notes, extra: json(k.extra), ...state } });
      kegId.set(key, c.id);
      await db.kegEvent.create({ data: { kegId: c.id, userId: user.userId, userName: user.name, action: "CREATED", toStatus: c.status, toPlace: placeLabel({ area: c.area, status: c.status, tapLine: c.tapLine }), note: `Imported (old code ${k.legacyCode})`, importKey: `imp:created:${stableHash(key)}` } }).catch(() => undefined);
      out.kegsCreated++;
    }
  }

  // History: one createMany per chunk, skipping keys already imported.
  for (let i = 0; i < plan.events.length; i += 2000) {
    const chunk = plan.events.slice(i, i + 2000);
    const data: Prisma.KegEventCreateManyInput[] = chunk.filter((e) => kegId.has(legacyKey(e.legacyCode))).map((e) => ({
      kegId: kegId.get(legacyKey(e.legacyCode))!,
      at: new Date(e.at),
      userName: e.user,
      action: e.action,
      toStatus: e.toStatus,
      toPlace: e.action === "OUT" ? (e.account ? `Out at ${e.account}` : "Out at an account") : e.area,
      beerId: beerOf(e.beer),
      accountId: accOf(e.account),
      note: e.note,
      importKey: e.importKey,
      extra: json(e.extra),
    }));
    const r = await db.kegEvent.createMany({ data, skipDuplicates: true });
    out.events += r.count;
  }

  // Fills rebuilt from each keg's whole imported history (tap → kick pairs calibrate the yield).
  const touched = [...new Set(plan.kegs.map((k) => kegId.get(legacyKey(k.legacyCode))!).filter(Boolean))];
  const beerNames = new Map([...beerId.entries()].map(([n, id]) => [id, n]));
  for (let i = 0; i < touched.length; i += 200) {
    const ids = touched.slice(i, i + 200);
    const evs = await db.kegEvent.findMany({ where: { kegId: { in: ids }, importKey: { not: null }, undoneAt: null }, orderBy: { at: "asc" }, select: { kegId: true, at: true, action: true, beerId: true, note: true } });
    const kegs = await db.keg.findMany({ where: { id: { in: ids } }, select: { id: true, legacyCode: true, status: true, beerId: true, fillId: true, tapLine: true } });
    for (const k of kegs) {
      const fills = fillsFromHistory(evs.filter((e) => e.kegId === k.id).map((e) => ({ at: e.at.toISOString(), action: e.action as never, beer: e.beerId ? beerNames.get(e.beerId) ?? null : null, batch: null })));
      let last: string | null = null;
      for (const f of fills) {
        const fk = `fill:${stableHash(`${legacyKey(k.legacyCode ?? k.id)}|${f.filledOn ?? f.tappedAt}`)}`;
        const data = { kegId: k.id, beerId: beerOf(f.beer), filledOn: f.filledOn ? new Date(`${f.filledOn.slice(0, 10)}T00:00:00Z`) : null, tappedAt: f.tappedAt ? new Date(f.tappedAt) : null, kickedAt: f.kickedAt ? new Date(f.kickedAt) : null, batchId: await batchOf(f.batch, f.beer) };
        const row = await db.kegFill.upsert({ where: { importKey: fk }, create: { ...data, importKey: fk }, update: data });
        out.fills++;
        if (!f.kickedAt) last = row.id;
      }
      // The keg's current fill: the open one from history, else one made from the keg list's fill columns.
      const full = k.status === "FILLED" || k.status === "COLD" || k.status === "ON_TAP" || k.status === "OUT";
      if (full && !k.fillId) {
        const pk = plan.kegs.find((x) => legacyKey(x.legacyCode) === legacyKey(k.legacyCode ?? ""));
        let fillId = last;
        if (!fillId) {
          const fk = `fill:${stableHash(`${legacyKey(k.legacyCode ?? k.id)}|current`)}`;
          const row = await db.kegFill.upsert({
            where: { importKey: fk },
            create: { importKey: fk, kegId: k.id, beerId: k.beerId, filledOn: day(pk?.filledOn ?? null), bestBy: day(pk?.bestBy ?? null), batchCode: pk?.batch ?? null, batchId: await batchOf(pk?.batch ?? null, pk?.beer ?? null), tapLine: k.status === "ON_TAP" ? k.tapLine : null },
            update: {},
          });
          fillId = row.id;
          out.fills++;
        }
        if (fillId === last && (pk?.batch || pk?.bestBy)) {
          await db.kegFill.update({ where: { id: fillId! }, data: { batchCode: pk.batch ?? undefined, batchId: (await batchOf(pk.batch ?? null, pk.beer ?? null)) ?? undefined, bestBy: day(pk.bestBy ?? null) ?? undefined } });
        }
        await db.keg.update({ where: { id: k.id }, data: { fillId } }).catch(() => undefined);
      }
    }
  }

  // Remember each file's mapping for next time (same columns → same choices).
  const sources = await loadSources(uploadId);
  const remembered = await rememberedMappings();
  for (const c of choices) {
    const s = sources[c.index];
    if (s) remembered[signature(headersOf(s.records))] = { entity: c.entity, mapping: c.mapping };
  }
  await db.setting.upsert({ where: { key: MAPPINGS_KEY }, create: { key: MAPPINGS_KEY, value: JSON.stringify(remembered) }, update: { value: JSON.stringify(remembered) } });
  await discardUpload(uploadId);
  return out;
}
