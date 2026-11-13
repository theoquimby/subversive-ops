import "server-only";
import { db } from "../db";
import { isSquareConnected } from "./square";

/**
 * First-run setup progress, stored as JSON in Setting `onboarding.progress`.
 * A step counts as done when the manager finished it in /welcome *or* when
 * the thing it sets up already exists (suppliers, data, Square…), so someone
 * who set things up elsewhere isn't nagged.
 */

export const ONBOARDING_STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "basics", label: "Business basics" },
  { id: "suppliers", label: "Suppliers" },
  { id: "data", label: "Your data" },
  { id: "square", label: "Square" },
  { id: "team", label: "Team logins" },
  { id: "phone", label: "First count" },
  { id: "done", label: "Done" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];
export const isStepId = (s: string): s is OnboardingStepId => ONBOARDING_STEPS.some((x) => x.id === s);

export interface OnboardingProgress {
  current: OnboardingStepId;
  completed: OnboardingStepId[];
  skipped: OnboardingStepId[];
  /** ISO timestamp once the manager reached the end. */
  finishedAt?: string;
  /** The "Finish setting up" card was dismissed. */
  dismissed?: boolean;
}

const KEY = "onboarding.progress";
const EMPTY: OnboardingProgress = { current: "welcome", completed: [], skipped: [] };

export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const s = await db.setting.findUnique({ where: { key: KEY } });
  if (!s) return EMPTY;
  try {
    const v = JSON.parse(s.value) as Partial<OnboardingProgress>;
    return {
      current: v.current && isStepId(v.current) ? v.current : "welcome",
      completed: (v.completed ?? []).filter(isStepId),
      skipped: (v.skipped ?? []).filter(isStepId),
      finishedAt: v.finishedAt,
      dismissed: v.dismissed,
    };
  } catch {
    return EMPTY;
  }
}

export async function saveOnboardingProgress(patch: Partial<OnboardingProgress>): Promise<OnboardingProgress> {
  const next = { ...(await getOnboardingProgress()), ...patch };
  const value = JSON.stringify(next);
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return next;
}

/** Mark a step finished or skipped and move to `next`. */
export async function recordStep(step: OnboardingStepId, status: "done" | "skipped" | "visit", next: OnboardingStepId) {
  const p = await getOnboardingProgress();
  const completed = new Set(p.completed);
  const skipped = new Set(p.skipped);
  if (status === "done") { completed.add(step); skipped.delete(step); }
  if (status === "skipped" && !completed.has(step)) skipped.add(step);
  return saveOnboardingProgress({
    current: next,
    completed: [...completed],
    skipped: [...skipped],
    ...(next === "done" || step === "done" ? { finishedAt: p.finishedAt ?? new Date().toISOString() } : {}),
  });
}

// ---- Business profile (name + time zone) -------------------------------------------

export interface BusinessProfile {
  name: string;
  timezone: string;
}

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const rows = await db.setting.findMany({ where: { key: { in: ["business.name", "business.timezone"] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return { name: get("business.name") ?? "Subversive", timezone: get("business.timezone") ?? process.env.BUSINESS_TIMEZONE ?? "America/New_York" };
}

export async function saveBusinessProfile(p: BusinessProfile) {
  await db.$transaction([
    db.setting.upsert({ where: { key: "business.name" }, create: { key: "business.name", value: p.name }, update: { value: p.name } }),
    db.setting.upsert({ where: { key: "business.timezone" }, create: { key: "business.timezone", value: p.timezone }, update: { value: p.timezone } }),
  ]);
}

// ---- State for "Finish setting up (3 of 8)" -----------------------------------------------

export interface OnboardingState {
  steps: { id: OnboardingStepId; label: string; done: boolean; skipped: boolean }[];
  done: number;
  total: number;
  /** Every step is done (or the manager reached the end of setup). */
  complete: boolean;
  /** Nothing has been set up and setup was never opened — a good moment to redirect to /welcome. */
  firstRun: boolean;
  dismissed: boolean;
  /** Where "Continue setup" should go. */
  href: string;
  current: OnboardingStepId;
}

export async function onboardingState(): Promise<OnboardingState> {
  const [p, settings, suppliers, ingredients, recipes, users, counts] = await Promise.all([
    getOnboardingProgress(),
    db.setting.count({ where: { key: { in: ["business.name", "openingHours"] } } }),
    db.supplier.count({ where: { active: true } }),
    db.ingredient.count(),
    db.recipe.count(),
    db.user.count({ where: { active: true } }),
    db.stockCount.count({ where: { completed: true } }),
  ]);
  const facts: Record<OnboardingStepId, boolean> = {
    welcome: p.completed.length > 0 || p.current !== "welcome",
    basics: settings > 0,
    suppliers: suppliers > 0,
    data: ingredients > 0 || recipes > 0,
    square: await isSquareConnected(),
    team: users > 1,
    phone: counts > 0,
    done: !!p.finishedAt,
  };
  const steps = ONBOARDING_STEPS.map((s) => ({ id: s.id, label: s.label, done: facts[s.id] || p.completed.includes(s.id), skipped: p.skipped.includes(s.id) && !facts[s.id] }));
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length || !!p.finishedAt,
    firstRun: !p.finishedAt && p.completed.length === 0 && p.current === "welcome" && ingredients === 0 && recipes === 0 && suppliers === 0,
    dismissed: !!p.dismissed,
    href: `/welcome?step=${p.current}`,
    current: p.current,
  };
}
