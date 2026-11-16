/**
 * New-hire onboarding: the default checklist and how far along someone is.
 * Items that mirror something already tracked elsewhere (documents signed,
 * training, certificates, availability, emergency contact) are worked out
 * from that data, so nobody ticks a thing twice. Payroll paperwork is only a
 * checkbox: W-4, I-9 and direct deposit are done in the payroll provider and
 * this app never asks for SSNs, bank details or tax IDs.
 */

import { addDays, type ISODate } from "./dates";

export const ONBOARDING_KINDS = ["DOCUMENT", "TRAINING", "CERT", "PAYROLL", "AVAILABILITY", "EMERGENCY", "TASK"] as const;
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];

export const KIND_LABEL: Record<OnboardingKind, string> = {
  DOCUMENT: "Read and sign",
  TRAINING: "Training",
  CERT: "Certificate",
  PAYROLL: "Payroll paperwork",
  AVAILABILITY: "Availability",
  EMERGENCY: "Emergency contact",
  TASK: "Task",
};

export interface ItemSpec {
  kind: OnboardingKind;
  title: string;
  detail?: string | null;
  refId?: string | null;
  required: boolean;
  staffCanTick: boolean;
}

/** The starting template: sensible for a taproom + kitchen in New York. Every line can be edited. */
export function defaultTemplateItems(provider: string): ItemSpec[] {
  return [
    { kind: "DOCUMENT", title: "Read and sign the handbook and policies", detail: "Everything marked “needs signing” on Me → Documents.", required: true, staffCanTick: false },
    { kind: "PAYROLL", title: `W-4, I-9 and direct deposit done in ${provider}`, detail: `Fill these in on ${provider} — never here. Bring your I-9 ID documents on your first shift.`, required: true, staffCanTick: true },
    { kind: "EMERGENCY", title: "Add an emergency contact", detail: "Who we call if something happens on shift.", required: true, staffCanTick: false },
    { kind: "AVAILABILITY", title: "Tell us when you can work", detail: "So you're only scheduled when you can make it.", required: true, staffCanTick: false },
    { kind: "TRAINING", title: "Finish your training checklist", detail: "Assigned for your position.", required: true, staffCanTick: false },
    { kind: "CERT", title: "Upload your certificates", detail: "ATAP for anyone serving alcohol, food handler for the kitchen — a photo of the card is fine.", required: true, staffCanTick: false },
    { kind: "TASK", title: "Uniform handed out", detail: "Shirts, apron, hat.", required: false, staffCanTick: false },
    { kind: "TASK", title: "Keys / door code given", detail: null, required: false, staffCanTick: false },
  ];
}

/** What's already true elsewhere in the app for this person. */
export interface OnboardingFacts {
  /** Staff documents that need signing, and the ones they've signed. */
  docsToSign: string[];
  signedDocs: Set<string>;
  /** moduleId → finished (completed or signed off). */
  training: Map<string, boolean>;
  /** certTypeId → valid today; only types they're required to hold unless asked by id. */
  certs: Map<string, boolean>;
  requiredCerts: string[];
  availabilitySet: boolean;
  emergencySet: boolean;
}

export interface ItemState {
  kind: OnboardingKind;
  refId?: string | null;
  doneAt: Date | string | null;
}

/** Done? Linked kinds follow the real data; tasks and the payroll checkbox follow their tick. */
export function itemDone(item: ItemState, f: OnboardingFacts): boolean {
  switch (item.kind) {
    case "DOCUMENT":
      return item.refId ? f.signedDocs.has(item.refId) : f.docsToSign.every((d) => f.signedDocs.has(d));
    case "TRAINING":
      if (item.refId) return f.training.get(item.refId) === true;
      return [...f.training.values()].every(Boolean) && (f.training.size > 0 || item.doneAt != null);
    case "CERT":
      if (item.refId) return f.certs.get(item.refId) === true;
      return f.requiredCerts.every((id) => f.certs.get(id) === true);
    case "AVAILABILITY":
      return f.availabilitySet || item.doneAt != null;
    case "EMERGENCY":
      return f.emergencySet;
    default:
      return item.doneAt != null;
  }
}

export interface Progress {
  done: number;
  total: number;
  requiredDone: number;
  requiredTotal: number;
  /** 0–1 over required items (all items when none are required). */
  pct: number;
  complete: boolean;
}

export function onboardingProgress(items: (ItemState & { required: boolean })[], f: OnboardingFacts): Progress {
  let done = 0;
  let requiredDone = 0;
  let requiredTotal = 0;
  for (const i of items) {
    const d = itemDone(i, f);
    if (d) done++;
    if (i.required) {
      requiredTotal++;
      if (d) requiredDone++;
    }
  }
  const pct = requiredTotal ? requiredDone / requiredTotal : items.length ? done / items.length : 1;
  return { done, total: items.length, requiredDone, requiredTotal, pct, complete: requiredDone === requiredTotal };
}

export type HireState = "done" | "overdue" | "on-track" | "not-started";

/** For the manager's list: finished, behind (past due with required items open), going, or untouched. */
export function hireState(p: Progress, dueOn: ISODate | null, today: ISODate): HireState {
  if (p.complete) return "done";
  if (dueOn && dueOn < today) return "overdue";
  return p.done === 0 ? "not-started" : "on-track";
}

/** Default due date: two weeks from the start date. */
export const defaultDue = (start: ISODate) => addDays(start, 14);

/**
 * People who look new and have no checklist yet: added in the last `days` days
 * (by hand or by the Square team sync), active, not already onboarded.
 */
export function likelyNewHires<E extends { id: string; active: boolean; createdAt: Date; startDate: Date | null }>(employees: E[], onboarded: Set<string>, now: Date, days = 30): E[] {
  const since = now.getTime() - days * 86_400_000;
  // The first batch (the team as it was when Ops was set up, or the first Square sync) isn't new.
  const first = Math.min(...employees.map((e) => e.createdAt.getTime()));
  const firstBatch = (e: E) => e.startDate == null && e.createdAt.getTime() - first < 2 * 86_400_000;
  return employees.filter((e) => e.active && !onboarded.has(e.id) && !firstBatch(e) && Math.max(e.createdAt.getTime(), e.startDate?.getTime() ?? 0) >= since);
}

/** The payroll provider's name and where to send people ("Square Payroll", "Gusto"). */
export interface PayrollProvider {
  id: "SQUARE_PAYROLL" | "GUSTO" | "OTHER";
  name: string;
  url: string;
}

export const PROVIDERS: Record<PayrollProvider["id"], PayrollProvider> = {
  SQUARE_PAYROLL: { id: "SQUARE_PAYROLL", name: "Square Payroll", url: "https://squareup.com/payroll" },
  GUSTO: { id: "GUSTO", name: "Gusto", url: "https://app.gusto.com" },
  OTHER: { id: "OTHER", name: "your payroll provider", url: "" },
};

export function parseProvider(raw: string | null | undefined): PayrollProvider {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<PayrollProvider>) : null;
    if (!v?.id || !(v.id in PROVIDERS)) return PROVIDERS.SQUARE_PAYROLL;
    const base = PROVIDERS[v.id];
    const url = typeof v.url === "string" && /^https:\/\//.test(v.url.trim()) ? v.url.trim() : base.url;
    const name = v.id === "OTHER" && typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 60) : base.name;
    return { id: v.id, name, url };
  } catch {
    return PROVIDERS.SQUARE_PAYROLL;
  }
}
