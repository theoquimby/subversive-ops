import "server-only";
import {
  assignmentState, buildMatrix, compliance, currentCert, EXPIRING_DAYS, NY_CERT_PRESETS, nextExpiry, presetPositions, pruneReminderKeys, reminderKey, reminderStage,
  requirementReason, withinExpiredWindow, worstStatus, type AssignmentState, type CellStatus, type CertStatus, type ComplianceSummary,
} from "@/domain/certs";
import { addDays, ISODate, toISODate } from "@/domain/dates";
import { db } from "../db";
import type { CertReminder } from "./notify";
import { businessToday } from "./sales";

/**
 * Training & certifications: certificate types (ATAP, ServSafe…), the
 * certificates people hold, onboarding checklists and their progress.
 * Pure rules live in @/domain/certs; this file loads and saves.
 */

export const MAX_CERT_BYTES = 8 * 1024 * 1024;
export const CERT_MIME = ["image/jpeg", "image/png", "application/pdf"] as const;

const PRESETS_KEY = "training.presetsSeeded";
const REMINDERS_KEY = "training.reminders.sent";

const iso = (d: Date | null | undefined) => (d ? toISODate(d) : null);

// ---- Presets ----------------------------------------------------------------------

/**
 * Add the New York starting set the first time training is opened. Runs once
 * (remembered in a Setting), so deleting or renaming a preset sticks.
 */
export async function ensureCertPresets(): Promise<void> {
  if (await db.setting.findUnique({ where: { key: PRESETS_KEY } })) return;
  const positions = await db.position.findMany({ select: { id: true, name: true, area: true } });
  const existing = new Set((await db.certType.findMany({ select: { name: true } })).map((t) => t.name.toLowerCase()));
  let sort = 0;
  for (const p of NY_CERT_PRESETS) {
    sort++;
    if (existing.has(p.name.toLowerCase())) continue;
    await db.certType.create({
      data: {
        name: p.name,
        description: p.description,
        issuer: p.issuer,
        validityMonths: p.validityMonths,
        appliesTo: presetPositions(p, positions),
        requiredForAll: !!p.requiredForAll,
        requiredForMinors: !!p.requiredForMinors,
        isAnnualTraining: !!p.isAnnualTraining,
        sort,
      },
    });
  }
  await db.setting.upsert({ where: { key: PRESETS_KEY }, create: { key: PRESETS_KEY, value: new Date().toISOString() }, update: {} });
}

// ---- Shapes sent to the page ------------------------------------------------------------

export interface CertView {
  id: string;
  number: string | null;
  issuedOn: ISODate;
  expiresOn: ISODate | null;
  overridden: boolean;
  hasFile: boolean;
  mime: string | null;
  filename: string | null;
  notes: string | null;
  uploadedBy: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface CellView {
  status: CertStatus;
  required: boolean;
  /** "everyone" | "minor" | "position" when required. */
  reason: string | null;
  expiresOn: ISODate | null;
  daysLeft: number | null;
  current: CertView | null;
  /** Every certificate of this type, newest first. */
  history: CertView[];
}

export interface TypeView {
  id: string;
  name: string;
  description: string | null;
  issuer: string | null;
  validityMonths: number | null;
  appliesTo: string[];
  requiredForAll: boolean;
  requiredForMinors: boolean;
  isAnnualTraining: boolean;
  active: boolean;
  /** People who must hold it / who hold it in date. */
  requiredCount: number;
  okCount: number;
}

export interface PersonView {
  id: string;
  name: string;
  isMinor: boolean;
  hasLogin: boolean;
  positionIds: string[];
  worst: CertStatus;
  compliant: boolean;
}

const certSelect = { id: true, employeeId: true, certTypeId: true, number: true, issuedOn: true, expiresOn: true, expiryOverridden: true, mime: true, size: true, filename: true, notes: true, uploadedBy: true, verifiedBy: true, verifiedAt: true, createdAt: true } as const;
type CertRow = { id: string; employeeId: string; certTypeId: string; number: string | null; issuedOn: Date; expiresOn: Date | null; expiryOverridden: boolean; mime: string | null; size: number | null; filename: string | null; notes: string | null; uploadedBy: string | null; verifiedBy: string | null; verifiedAt: Date | null; createdAt: Date };

const certView = (c: CertRow): CertView => ({
  id: c.id,
  number: c.number,
  issuedOn: toISODate(c.issuedOn),
  expiresOn: iso(c.expiresOn),
  overridden: c.expiryOverridden,
  hasFile: c.size != null && c.size > 0,
  mime: c.mime,
  filename: c.filename,
  notes: c.notes,
  uploadedBy: c.uploadedBy,
  verifiedBy: c.verifiedBy,
  verifiedAt: c.verifiedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
});

const asDomain = (c: CertRow) => ({ id: c.id, employeeId: c.employeeId, certTypeId: c.certTypeId, issuedOn: toISODate(c.issuedOn), expiresOn: iso(c.expiresOn), verified: !!c.verifiedAt });

// ---- Matrix -----------------------------------------------------------------------------

/** Everyone active × every active type, with status, history and the roll-up. */
export async function certMatrix(today: ISODate = businessToday()) {
  const [types, employees, rows] = await Promise.all([
    db.certType.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] }),
    db.employee.findMany({ where: { active: true }, select: { id: true, name: true, isMinor: true, userId: true, positions: { select: { positionId: true } } }, orderBy: { name: "asc" } }),
    db.certification.findMany({ where: { employee: { active: true } }, select: certSelect, orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }] }),
  ]);
  const active = types.filter((t) => t.active);
  const people = employees.map((e) => ({ id: e.id, positionIds: e.positions.map((p) => p.positionId), isMinor: e.isMinor }));
  const matrix = buildMatrix(people, active, rows.map(asDomain), today);
  const byPair = new Map<string, CertRow[]>();
  for (const r of rows) byPair.set(`${r.employeeId}|${r.certTypeId}`, [...(byPair.get(`${r.employeeId}|${r.certTypeId}`) ?? []), r]);

  const cells: Record<string, Record<string, CellView>> = {};
  const all: CellStatus<unknown>[] = [];
  for (const row of matrix) {
    const p = people.find((x) => x.id === row.employeeId)!;
    cells[row.employeeId] = {};
    for (const t of active) {
      const c = row.cells[t.id];
      all.push(c);
      const history = byPair.get(`${row.employeeId}|${t.id}`) ?? [];
      cells[row.employeeId][t.id] = {
        status: c.status,
        required: c.required,
        reason: requirementReason(t, p),
        expiresOn: c.expiresOn,
        daysLeft: c.daysLeft,
        current: c.cert ? certView(history.find((h) => h.id === c.cert!.id)!) : null,
        history: history.map(certView),
      };
    }
  }
  const typeViews: TypeView[] = types.map((t) => {
    const col = matrix.map((r) => r.cells[t.id]).filter(Boolean);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      issuer: t.issuer,
      validityMonths: t.validityMonths,
      appliesTo: t.appliesTo,
      requiredForAll: t.requiredForAll,
      requiredForMinors: t.requiredForMinors,
      isAnnualTraining: t.isAnnualTraining,
      active: t.active,
      requiredCount: col.filter((c) => c.required).length,
      okCount: col.filter((c) => c.required && (c.status === "valid" || c.status === "expiring")).length,
    };
  });
  const personViews: PersonView[] = employees.map((e) => {
    const mine = Object.values(cells[e.id]);
    const summary = compliance(mine);
    return { id: e.id, name: e.name, isMinor: e.isMinor, hasLogin: !!e.userId, positionIds: e.positions.map((p) => p.positionId), worst: worstStatus(mine), compliant: summary.ok === summary.required };
  });
  const summary: ComplianceSummary & { nextExpiry: ISODate | null; unverified: number } = {
    ...compliance(all),
    nextExpiry: nextExpiry(all),
    unverified: Object.values(cells).flatMap((r) => Object.values(r)).filter((c) => c.current && !c.current.verifiedAt).length,
  };
  return { today, types: typeViews, people: personViews, cells, summary };
}
export type CertMatrix = Awaited<ReturnType<typeof certMatrix>>;

/** One chip per person for the Team page: their worst required status. */
export async function teamCertChips(): Promise<Map<string, { status: CertStatus; label: string }>> {
  const m = await certMatrix();
  const out = new Map<string, { status: CertStatus; label: string }>();
  for (const p of m.people) {
    const cells = Object.values(m.cells[p.id]);
    const count = (s: CertStatus) => cells.filter((c) => c.required && c.status === s).length;
    const label = p.worst === "expired" ? `${count("expired")} expired` : p.worst === "missing" ? `${count("missing")} missing` : p.worst === "expiring" ? `${count("expiring")} expiring` : p.worst === "valid" ? "Certs OK" : "No certs needed";
    out.set(p.id, { status: p.worst, label });
  }
  return out;
}

// ---- Checklists ---------------------------------------------------------------------------

export interface ModuleView {
  id: string;
  title: string;
  description: string | null;
  positionIds: string[];
  active: boolean;
  steps: { id: string; title: string; detail: string | null; documentId: string | null; documentTitle: string | null }[];
  assignments: AssignmentView[];
}

export interface AssignmentView {
  id: string;
  employeeId: string;
  employeeName: string;
  assignedAt: string;
  dueOn: ISODate | null;
  done: number;
  total: number;
  doneStepIds: string[];
  state: AssignmentState;
  signedOffBy: string | null;
  signedOffAt: string | null;
}

export async function trainingModules(today: ISODate = businessToday()): Promise<ModuleView[]> {
  const mods = await db.trainingModule.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: {
      steps: { orderBy: { sort: "asc" }, include: { document: { select: { title: true, active: true } } } },
      assignments: { include: { employee: { select: { name: true, active: true } }, completions: { select: { stepId: true } } }, orderBy: { assignedAt: "asc" } },
    },
  });
  return mods.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    positionIds: m.positionIds,
    active: m.active,
    steps: m.steps.map((s) => ({ id: s.id, title: s.title, detail: s.detail, documentId: s.document?.active ? s.documentId : null, documentTitle: s.document?.active ? s.document.title : null })),
    assignments: m.assignments.filter((a) => a.employee.active).map((a) => assignmentView(a, m.steps.map((s) => s.id), today)),
  }));
}

function assignmentView(
  a: { id: string; employeeId: string; employee: { name: string }; assignedAt: Date; dueOn: Date | null; signedOffBy: string | null; signedOffAt: Date | null; completions: { stepId: string }[] },
  stepIds: string[],
  today: ISODate,
): AssignmentView {
  const doneIds = a.completions.map((c) => c.stepId).filter((id) => stepIds.includes(id));
  const dueOn = iso(a.dueOn);
  return {
    id: a.id,
    employeeId: a.employeeId,
    employeeName: a.employee.name,
    assignedAt: a.assignedAt.toISOString(),
    dueOn,
    done: doneIds.length,
    total: stepIds.length,
    doneStepIds: doneIds,
    state: assignmentState({ dueOn, signedOffAt: a.signedOffAt }, doneIds.length, stepIds.length, today),
    signedOffBy: a.signedOffBy,
    signedOffAt: a.signedOffAt?.toISOString() ?? null,
  };
}

/** Documents a checklist step can link to (staff-visible ones, so staff can open them). */
export async function linkableDocuments() {
  return db.document.findMany({ where: { active: true, audience: "STAFF" }, select: { id: true, title: true }, orderBy: { title: "asc" } });
}

// ---- Staff ---------------------------------------------------------------------------------

/** What one person sees on /my: their requirements and checklists. */
export async function myTraining(employeeId: string, today: ISODate = businessToday()) {
  const [emp, types, rows, assignments] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { isMinor: true, positions: { select: { positionId: true } } } }),
    db.certType.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] }),
    db.certification.findMany({ where: { employeeId }, select: certSelect, orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }] }),
    db.trainingAssignment.findMany({
      where: { employeeId, module: { active: true } },
      include: {
        employee: { select: { name: true } },
        completions: { select: { stepId: true } },
        module: { include: { steps: { orderBy: { sort: "asc" }, include: { document: { select: { title: true, active: true, audience: true } } } } } },
      },
      orderBy: { assignedAt: "asc" },
    }),
  ]);
  if (!emp) return { certs: [], checklists: [] };
  const person = { positionIds: emp.positions.map((p) => p.positionId), isMinor: emp.isMinor };
  const certs = types
    .map((t) => {
      const mine = rows.filter((r) => r.certTypeId === t.id);
      const reason = requirementReason(t, person);
      if (!reason && mine.length === 0) return null;
      const m = buildMatrix([{ id: employeeId, ...person }], [t], mine.map(asDomain), today)[0].cells[t.id];
      const cur = m.cert ? mine.find((r) => r.id === m.cert!.id)! : null;
      // A card uploaded today but not yet checked shows as "waiting for a manager" on top of its status.
      const latest = mine[0] ? certView(mine[0]) : null;
      return { typeId: t.id, name: t.name, description: t.description, issuer: t.issuer, validityMonths: t.validityMonths, isAnnualTraining: t.isAnnualTraining, required: !!reason, reason, status: m.status, expiresOn: m.expiresOn, daysLeft: m.daysLeft, current: cur ? certView(cur) : null, latest };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Number(b.required) - Number(a.required));
  const checklists = assignments.map((a) => {
    const steps = a.module.steps.map((s) => ({ id: s.id, title: s.title, detail: s.detail, documentId: s.document?.active && s.document.audience === "STAFF" ? s.documentId : null, documentTitle: s.document?.active && s.document.audience === "STAFF" ? s.document.title : null }));
    return { ...assignmentView(a, steps.map((s) => s.id), today), moduleId: a.moduleId, title: a.module.title, description: a.module.description, steps };
  });
  return { certs, checklists };
}
export type MyTraining = Awaited<ReturnType<typeof myTraining>>;

// ---- Brief ---------------------------------------------------------------------------------

/** For the weekly brief: what's expired, expiring, missing, and checklists past due. */
export async function trainingBrief(today: ISODate = businessToday()) {
  const [m, mods] = await Promise.all([certMatrix(today), trainingModules(today)]);
  const names = new Map(m.people.map((p) => [p.id, p.name]));
  const typeNames = new Map(m.types.map((t) => [t.id, t.name]));
  const list = (s: CertStatus) =>
    Object.entries(m.cells).flatMap(([eid, row]) =>
      Object.entries(row)
        .filter(([, c]) => c.required && c.status === s)
        .map(([tid, c]) => ({ employeeId: eid, person: names.get(eid) ?? "Someone", cert: typeNames.get(tid) ?? "Certificate", expiresOn: c.expiresOn, daysLeft: c.daysLeft })),
    );
  const expiring = list("expiring").sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));
  const overdue = mods.flatMap((mod) => mod.assignments.filter((a) => a.state === "overdue").map((a) => ({ person: a.employeeName, module: mod.title, dueOn: a.dueOn, done: a.done, total: a.total })));
  const ready = mods.flatMap((mod) => mod.assignments.filter((a) => a.state === "ready").map((a) => ({ person: a.employeeName, module: mod.title })));
  return { summary: m.summary, expired: list("expired"), expiring, missing: list("missing"), overdue, ready, hasTypes: m.types.some((t) => t.active) };
}
export type TrainingBrief = Awaited<ReturnType<typeof trainingBrief>>;

// ---- Ask ------------------------------------------------------------------------------------

/** Rows for "who has an expired ATAP?" — every required (or held) cell, optionally narrowed. */
export async function certStatusRows(filter: { cert?: string; status?: CertStatus | "attention" } = {}) {
  const m = await certMatrix();
  const q = filter.cert?.trim().toLowerCase();
  const types = m.types.filter((t) => t.active && (!q || t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase())));
  const rows = m.people.flatMap((p) =>
    types.map((t) => ({ person: p.name, employeeId: p.id, cert: t.name, ...m.cells[p.id][t.id] })).filter((c) => c.required || c.current),
  );
  const keep = (s: CertStatus) => !filter.status || (filter.status === "attention" ? s === "expired" || s === "expiring" || s === "missing" : s === filter.status);
  return { summary: m.summary, types: types.map((t) => t.name), matchedType: !!q && types.length > 0, rows: rows.filter((r) => keep(r.status)) };
}

// ---- Reminders --------------------------------------------------------------------------

/**
 * Daily: tell people (with a login) and managers about certificates 30 and 7
 * days before expiry and once expired. Each certificate × stage is sent once,
 * remembered in the Setting `training.reminders.sent`. Never throws.
 */
export async function certificateReminders(today: ISODate = businessToday()): Promise<{ due: number; emailed?: number; pushed?: number; skipped?: string[]; errors?: string[] }> {
  try {
    const horizon = addDays(today, 30);
    const rows = await db.certification.findMany({
      where: { employee: { active: true }, certType: { active: true } },
      select: { id: true, employeeId: true, certTypeId: true, issuedOn: true, expiresOn: true, certType: { select: { name: true } }, employee: { select: { name: true, email: true, userId: true } } },
    });
    // Only the certificate that counts per person × type: a renewal silences the old card.
    const pairs = new Map<string, typeof rows>();
    for (const r of rows) pairs.set(`${r.employeeId}|${r.certTypeId}`, [...(pairs.get(`${r.employeeId}|${r.certTypeId}`) ?? []), r]);
    const sentRow = await db.setting.findUnique({ where: { key: REMINDERS_KEY } });
    let sent: string[] = [];
    try { sent = sentRow ? (JSON.parse(sentRow.value) as string[]) : []; } catch { sent = []; }
    const sentSet = new Set(sent);
    const due: CertReminder[] = [];
    for (const list of pairs.values()) {
      const cur = currentCert(list.filter((r) => toISODate(r.issuedOn) <= today).map((r) => ({ ...r, issuedOn: toISODate(r.issuedOn), expiresOn: iso(r.expiresOn) })));
      if (!cur?.expiresOn || cur.expiresOn > horizon) continue;
      const stage = reminderStage(cur.expiresOn, today);
      if (!stage || (stage === "expired" && !withinExpiredWindow(cur.expiresOn, today))) continue;
      if (sentSet.has(reminderKey(cur.id, stage))) continue;
      // Reaching "7" first (a late upload) also counts as the 30-day one.
      due.push({ certId: cur.id, person: cur.employee.name, cert: cur.certType.name, expiresOn: cur.expiresOn, stage, employee: cur.employee });
    }
    if (due.length === 0) return { due: 0 };
    const next = pruneReminderKeys([...sent, ...due.map((d) => reminderKey(d.certId, d.stage))], new Set(rows.map((r) => r.id)));
    const value = JSON.stringify(next);
    // Mark first: a slow or failed send must not turn into a repeat tomorrow.
    await db.setting.upsert({ where: { key: REMINDERS_KEY }, create: { key: REMINDERS_KEY, value }, update: { value } });
    // Loaded lazily: notify → brief → training would otherwise import in a circle.
    const { notifyCertificateReminders } = await import("./notify");
    const r = await notifyCertificateReminders(due);
    return { due: due.length, emailed: r.emailed, pushed: r.pushed, skipped: r.skipped, errors: r.errors };
  } catch (e) {
    console.error("certificate reminders failed", e);
    return { due: 0, errors: [(e as Error).message] };
  }
}

export { EXPIRING_DAYS };

// ---- Saving ---------------------------------------------------------------------------------

/** Read an uploaded card (already compressed in the browser). Returns the columns to store, or a sentence. */
export async function certFileData(f: FormDataEntryValue | null): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string; size: number; filename: string } | { error: string } | null> {
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_CERT_BYTES) return { error: `That file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 8 MB — try a photo instead.` };
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  const mime = (CERT_MIME as readonly string[]).includes(f.type) ? f.type : ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" } as Record<string, string>)[ext];
  if (!mime) return { error: "Upload a photo (JPEG or PNG) or a PDF." };
  return { bytes: new Uint8Array(await f.arrayBuffer()), mime, size: f.size, filename: f.name.slice(0, 200) };
}

/** Recompute expiry for certificates of a type whose expiry wasn't set by hand (after its validity changes). */
export async function recomputeExpiries(certTypeId: string, validityMonths: number | null, expiryFor: (issued: ISODate, months: number | null) => ISODate | null) {
  const rows = await db.certification.findMany({ where: { certTypeId, expiryOverridden: false }, select: { id: true, issuedOn: true } });
  for (const r of rows) {
    const e = expiryFor(toISODate(r.issuedOn), validityMonths);
    await db.certification.update({ where: { id: r.id }, data: { expiresOn: e ? new Date(`${e}T00:00:00Z`) : null } });
  }
}

/** Shared with the staff action: tick/untick a step and keep completedAt in step with "all ticked". */
export async function setStepDone(assignmentId: string, stepId: string, done: boolean, by: string) {
  const a = await db.trainingAssignment.findUnique({ where: { id: assignmentId }, include: { module: { select: { steps: { select: { id: true } } } } } });
  if (!a || !a.module.steps.some((x) => x.id === stepId)) return;
  if (done) await db.trainingStepCompletion.upsert({ where: { assignmentId_stepId: { assignmentId, stepId } }, create: { assignmentId, stepId, completedBy: by }, update: {} });
  else await db.trainingStepCompletion.deleteMany({ where: { assignmentId, stepId } });
  const count = await db.trainingStepCompletion.count({ where: { assignmentId, stepId: { in: a.module.steps.map((x) => x.id) } } });
  const complete = count >= a.module.steps.length;
  if (complete !== !!a.completedAt) await db.trainingAssignment.update({ where: { id: assignmentId }, data: { completedAt: complete ? new Date() : null } });
}
