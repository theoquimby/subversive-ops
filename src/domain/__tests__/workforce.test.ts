import { describe, expect, it } from "vitest";
import { NY_DEFAULT_RULES } from "../labor";
import type { PayrollRow, PayrollTotals } from "../payroll";
import { autoApproveDecision, DEFAULT_SWAP_RULES, parseSwapLog, parseSwapRules, appendLog, swapEligibility, swapStage, type SwapCandidate, type SwapShift } from "../swaps";
import { defaultTemplateItems, hireState, itemDone, likelyNewHires, onboardingProgress, parseProvider, type OnboardingFacts } from "../onboarding";
import { dateMilestones, parseRecognition, perfectAttendance, pointsBalance, shoutoutPoints, tenure, trainingMilestones } from "../recognition";
import { accountantSummaryCsv, exportFile, GUSTO_HEADER, gustoCsv, handoffSteps, periodLabel, SQUARE_PAYROLL_HEADER, splitName, squarePayrollCsv, tipParts, type HandoffFacts } from "../payrollHandoff";
import { coverPeak, coversFromChecks, hourlyCovers, parseGuestsPerCheck, productivity } from "../covers";
import { cardHours, myPay, recentTipRate } from "../myPay";

// Business times as plain UTC for the tests: minutes from midnight of `date`.
const instant = (date: string, min: number) => new Date(Date.parse(`${date}T00:00:00Z`) + min * 60_000);
const localHour = (d: Date) => d.getUTCHours();
const opts = { instant, localHour };

const shift = (id: string, date: string, from: number, to: number, positionId = "bar"): SwapShift => ({ id, positionId, date, startMin: from * 60, endMin: to * 60, breakMinutes: to - from > 6 ? 30 : 0 });
const person = (over: Partial<SwapCandidate> = {}): SwapCandidate => ({
  id: "e1",
  name: "Sam Lee",
  positionIds: ["bar"],
  isMinor: false,
  maxHoursWeek: null,
  timeOff: new Set(),
  rate: 18,
  missingCerts: [],
  weekShifts: [],
  ...over,
});

describe("swap eligibility", () => {
  const target = shift("t", "2026-11-20", 16, 22);

  it("lets someone free and in the right role take it", () => {
    const e = swapEligibility(target, person(), NY_DEFAULT_RULES, opts);
    expect(e.eligible).toBe(true);
    expect(e.reasons).toEqual([]);
    expect(e.hoursAfter).toBe(6);
  });

  it("needs the same position", () => {
    const e = swapEligibility(target, person({ positionIds: ["kitchen"] }), NY_DEFAULT_RULES, opts);
    expect(e.eligible).toBe(false);
    expect(e.reasons[0]).toMatch(/position/);
  });

  it("refuses double-booking and approved time off", () => {
    const busy = swapEligibility(target, person({ weekShifts: [shift("x", "2026-11-20", 15, 19)] }), NY_DEFAULT_RULES, opts);
    expect(busy.eligible).toBe(false);
    expect(busy.reasons).toContain("Already working then");
    const off = swapEligibility(target, person({ timeOff: new Set(["2026-11-20"]) }), NY_DEFAULT_RULES, opts);
    expect(off.reasons).toContain("On approved time off");
  });

  it("refuses a shift that puts the week into overtime", () => {
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"].map((d, i) => shift(`w${i}`, d, 10, 20)); // 4 × 9.5h = 38h
    const e = swapEligibility(target, person({ weekShifts: week }), NY_DEFAULT_RULES, opts);
    expect(e.eligible).toBe(false);
    expect(e.reasons).toContain("Would go into overtime (44h that week)");
    // Already over: more hours are still more overtime.
    const over = [...week, shift("w5", "2026-11-21", 10, 20)];
    expect(swapEligibility(shift("t2", "2026-11-22", 10, 14), person({ weekShifts: over }), NY_DEFAULT_RULES, opts).eligible).toBe(false);
  });

  it("respects a personal weekly max", () => {
    const e = swapEligibility(target, person({ maxHoursWeek: 20, weekShifts: [shift("a", "2026-11-17", 10, 19), shift("b", "2026-11-18", 10, 19)] }), NY_DEFAULT_RULES, opts);
    expect(e.eligible).toBe(false);
    expect(e.reasons.join()).toMatch(/weekly max/);
  });

  it("applies NY minor rules", () => {
    const late = swapEligibility(shift("late", "2026-11-20", 17, 23), person({ isMinor: true }), NY_DEFAULT_RULES, opts);
    expect(late.eligible).toBe(false);
    expect(late.reasons).toContain("Too late a finish for a minor");
  });

  it("needs certificates the position requires", () => {
    const e = swapEligibility(target, person({ missingCerts: ["ATAP"] }), NY_DEFAULT_RULES, opts);
    expect(e.eligible).toBe(false);
    expect(e.reasons).toContain("No valid ATAP");
  });

  it("treats availability and clopens as warnings, not blockers", () => {
    const e = swapEligibility(target, person({ availability: { 5: [[9, 15]] }, weekShifts: [shift("close", "2026-11-19", 16, 26)] }), NY_DEFAULT_RULES, opts);
    expect(e.eligible).toBe(true);
    expect(e.warnings).toContain("Outside the times they said they can work");
  });

  it("ignores rules switched off in settings", () => {
    const rules = { ...NY_DEFAULT_RULES, ruleSettings: { overtime: { on: false } } };
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"].map((d, i) => shift(`w${i}`, d, 10, 20));
    expect(swapEligibility(target, person({ weekShifts: week }), rules, opts).eligible).toBe(true);
  });

  it("leaves out the shift they give back in a trade", () => {
    const e = swapEligibility(target, person({ weekShifts: [shift("t", "2026-11-20", 16, 22)] }), NY_DEFAULT_RULES, opts);
    expect(e.eligible).toBe(true);
  });
});

describe("swap rules and auto-approve", () => {
  const ok = { eligible: true, reasons: [], warnings: [], hoursBefore: 0, hoursAfter: 6 };
  const warn = { ...ok, warnings: ["Outside the times they said they can work"] };
  const no = { ...ok, eligible: false, reasons: ["Already working then"] };

  it("parses settings tolerantly", () => {
    expect(parseSwapRules(null)).toEqual(DEFAULT_SWAP_RULES);
    expect(parseSwapRules("{bad")).toEqual(DEFAULT_SWAP_RULES);
    expect(parseSwapRules(JSON.stringify({ autoApprove: "clean", minNoticeHours: 12 })).autoApprove).toBe("clean");
    expect(parseSwapRules(JSON.stringify({ minNoticeHours: -3 })).minNoticeHours).toBe(24);
  });

  it("never auto-approves a drop, and follows the mode for swaps", () => {
    const rules = { ...DEFAULT_SWAP_RULES, autoApprove: "eligible" as const };
    expect(autoApproveDecision(rules, "DROP", [ok], 100).auto).toBe(false);
    expect(autoApproveDecision(rules, "GIVE", [ok], 100).auto).toBe(true);
    expect(autoApproveDecision(rules, "GIVE", [no], 100).auto).toBe(false);
    expect(autoApproveDecision(rules, "GIVE", [ok], 5).auto).toBe(false);
    expect(autoApproveDecision({ ...rules, autoApprove: "clean" }, "SWAP", [ok, warn], 100).auto).toBe(false);
    expect(autoApproveDecision({ ...rules, autoApprove: "off" }, "GIVE", [ok], 100).auto).toBe(false);
  });

  it("open shifts go to the first eligible person unless pickups need approval", () => {
    expect(autoApproveDecision(DEFAULT_SWAP_RULES, "PICKUP", [ok], 1).auto).toBe(true);
    expect(autoApproveDecision({ ...DEFAULT_SWAP_RULES, openShiftsInstant: false }, "PICKUP", [ok], 100).auto).toBe(false);
  });

  it("keeps a history and knows the stage", () => {
    const log = appendLog(appendLog([], "Sam", "Posted"), "Max", "Approved", new Date("2026-11-16T12:00:00Z"));
    expect(log.map((l) => l.what)).toEqual(["Posted", "Approved"]);
    expect(parseSwapLog("nope")).toEqual([]);
    expect(swapStage({ status: "PENDING", takerId: null, claimedAt: null })).toBe("open");
    expect(swapStage({ status: "PENDING", takerId: "x", claimedAt: null })).toBe("asked");
    expect(swapStage({ status: "PENDING", takerId: "x", claimedAt: new Date() })).toBe("claimed");
    expect(swapStage({ status: "CANCELLED", takerId: null, claimedAt: null })).toBe("cancelled");
  });
});

describe("onboarding progress", () => {
  const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({
    docsToSign: ["hb", "pol"],
    signedDocs: new Set(),
    training: new Map(),
    certs: new Map(),
    requiredCerts: [],
    availabilitySet: false,
    emergencySet: false,
    ...over,
  });

  it("starts from a template that never asks for tax or bank details", () => {
    const items = defaultTemplateItems("Gusto");
    expect(items.find((i) => i.kind === "PAYROLL")?.title).toContain("Gusto");
    expect(JSON.stringify(items)).not.toMatch(/SSN|social security|routing|account number/i);
  });

  it("follows the real data for linked items", () => {
    expect(itemDone({ kind: "DOCUMENT", doneAt: null }, facts({ signedDocs: new Set(["hb"]) }))).toBe(false);
    expect(itemDone({ kind: "DOCUMENT", doneAt: null }, facts({ signedDocs: new Set(["hb", "pol"]) }))).toBe(true);
    expect(itemDone({ kind: "DOCUMENT", refId: "hb", doneAt: null }, facts({ signedDocs: new Set(["hb"]) }))).toBe(true);
    expect(itemDone({ kind: "TRAINING", doneAt: null }, facts({ training: new Map([["m", false]]) }))).toBe(false);
    expect(itemDone({ kind: "TRAINING", doneAt: null }, facts({ training: new Map([["m", true]]) }))).toBe(true);
    expect(itemDone({ kind: "CERT", doneAt: null }, facts({ requiredCerts: ["atap"], certs: new Map([["atap", true]]) }))).toBe(true);
    expect(itemDone({ kind: "EMERGENCY", doneAt: new Date() }, facts())).toBe(false);
    expect(itemDone({ kind: "PAYROLL", doneAt: new Date() }, facts())).toBe(true);
  });

  it("counts required items for completion", () => {
    const items = [
      { kind: "PAYROLL" as const, doneAt: new Date(), required: true },
      { kind: "EMERGENCY" as const, doneAt: null, required: true },
      { kind: "TASK" as const, doneAt: null, required: false },
    ];
    const p = onboardingProgress(items, facts());
    expect(p).toMatchObject({ done: 1, total: 3, requiredDone: 1, requiredTotal: 2, complete: false });
    expect(p.pct).toBe(0.5);
    const done = onboardingProgress(items, facts({ emergencySet: true }));
    expect(done.complete).toBe(true);
    expect(hireState(done, "2026-11-01", "2026-11-16")).toBe("done");
    expect(hireState(p, "2026-11-01", "2026-11-16")).toBe("overdue");
    expect(hireState(p, "2026-12-01", "2026-11-16")).toBe("on-track");
  });

  it("spots new people without a checklist", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    const list = likelyNewHires(
      [
        { id: "new", active: true, createdAt: new Date("2026-11-10"), startDate: null },
        { id: "old", active: true, createdAt: new Date("2025-01-10"), startDate: null },
        { id: "setup", active: true, createdAt: new Date("2025-01-11"), startDate: null },
        { id: "done", active: true, createdAt: new Date("2026-11-12"), startDate: null },
        { id: "gone", active: false, createdAt: new Date("2026-11-12"), startDate: null },
      ],
      new Set(["done"]),
      now,
    );
    expect(list.map((e) => e.id)).toEqual(["new"]);
    // A team imported all at once when the app was set up last week isn't "new".
    const batch = [0, 1, 2].map((i) => ({ id: `b${i}`, active: true, createdAt: new Date(`2026-11-1${i}T10:00:00Z`), startDate: null }));
    expect(likelyNewHires(batch.slice(0, 2), new Set(), now)).toEqual([]);
  });

  it("reads the payroll provider setting safely", () => {
    expect(parseProvider(null).name).toBe("Square Payroll");
    expect(parseProvider(JSON.stringify({ id: "GUSTO" })).name).toBe("Gusto");
    expect(parseProvider(JSON.stringify({ id: "OTHER", name: "ADP", url: "javascript:alert(1)" })).url).toBe("");
  });
});

describe("recognition", () => {
  it("parses config and works out points", () => {
    const cfg = parseRecognition(JSON.stringify({ values: ["  Hustle ", ""], pointsEnabled: true, managerPoints: 10 }));
    expect(cfg.values).toEqual(["Hustle"]);
    expect(shoutoutPoints(cfg, true)).toBe(10);
    expect(shoutoutPoints(cfg, false)).toBe(5);
    expect(shoutoutPoints(parseRecognition(null), true)).toBe(0);
    expect(pointsBalance([{ points: 10 }, { points: 5, hidden: true }], [{ points: 4, status: "PENDING" }, { points: 3, status: "DENIED" }])).toBe(6);
  });

  it("finds anniversaries and first months in a window", () => {
    const m = dateMilestones(
      [
        { id: "a", name: "Ava Abbott", start: "2024-11-18" },
        { id: "b", name: "Ben Cole", start: "2026-10-20" },
        { id: "c", name: "Cy Dunn", start: "2026-11-01" },
      ],
      "2026-11-16",
      "2026-11-22",
    );
    expect(m.map((x) => x.title)).toEqual(["Ava: 2 years with us", "Ben's first month"]);
  });

  it("clamps month-end starts", () => {
    expect(dateMilestones([{ id: "x", name: "X", start: "2026-01-31" }], "2026-02-01", "2026-03-01")[0].date).toBe("2026-02-28");
  });

  it("gives perfect attendance only to people on time for every shift", () => {
    const shifts = Array.from({ length: 8 }, (_, i) => ({ employeeId: "a", date: `2026-11-0${i + 1}`, start: Date.parse(`2026-11-0${i + 1}T20:00:00Z`) }));
    const onTime = shifts.map((s) => ({ employeeId: "a", clockIn: s.start + 2 * 60_000 }));
    expect(perfectAttendance(shifts, onTime).has("a")).toBe(true);
    const late = [...onTime.slice(1), { employeeId: "a", clockIn: shifts[0].start + 20 * 60_000 }];
    expect(perfectAttendance(shifts, late).has("a")).toBe(false);
    expect(perfectAttendance(shifts.slice(0, 3), onTime).has("a")).toBe(false);
  });

  it("lists finished training and says how long someone's been here", () => {
    expect(trainingMilestones([{ employeeId: "a", name: "Ava A", module: "Bar basics", date: "2026-11-15" }], "2026-11-10", "2026-11-16")[0].title).toBe("Ava finished Bar basics");
    expect(tenure("2026-11-10", "2026-11-16")).toBe("6 days");
    expect(tenure("2024-11-10", "2026-11-16")).toBe("2 years");
  });
});

const row = (over: Partial<PayrollRow> = {}): PayrollRow => ({
  employeeId: "e1",
  name: "Ava Abbott",
  squareTeamMemberId: "TM1",
  rate: 20,
  regularHours: 38,
  overtimeHours: 2,
  spreadHours: 0,
  spreadPay: 0,
  callInHours: 0,
  callInPay: 0,
  sickHours: 4,
  sickPay: 80,
  ptoHours: 0,
  ptoPay: 0,
  wages: 820,
  adjustments: 25,
  reimbursements: 12.5,
  adjustmentNotes: "Bonus $25.00",
  gross: 925,
  tips: 300,
  sickBalance: 10,
  missingRate: false,
  openCards: 0,
  ...over,
});
const totals: PayrollTotals = { hours: 40, overtimeHours: 2, wages: 820, gross: 925, tips: 300, adjustments: 25, reimbursements: 12.5 };
const meta = { start: "2026-11-09", end: "2026-11-15", status: "APPROVED" as const, burdenPct: 0.12, overtimeMultiplier: 1.5, provider: "Gusto" };

describe("payroll export formats", () => {
  const split = new Map([["e1", { card: 200, cash: 100 }]]);

  it("splits names and tips", () => {
    expect(splitName("Ava Abbott-Lee")).toEqual(["Ava", "Abbott-Lee"]);
    expect(splitName("Mary Jo Smith")).toEqual(["Mary Jo", "Smith"]);
    expect(splitName("Cher")).toEqual(["Cher", ""]);
    expect(tipParts(row(), split)).toEqual({ card: 200, cash: 100 });
    expect(tipParts(row())).toEqual({ card: 300, cash: 0 });
  });

  it("writes the Square Payroll layout", () => {
    const lines = squarePayrollCsv([row()], split).trim().split("\n");
    expect(lines[0]).toBe(SQUARE_PAYROLL_HEADER.join(","));
    expect(lines[1]).toBe("TM1,Ava,Abbott,38.00,2.00,4.00,0.00,100.00,200.00,25.00,12.50,20.00");
  });

  it("writes the Gusto layout, with spread and call-in pay as a correction", () => {
    const lines = gustoCsv([row({ spreadPay: 16, callInPay: 32, adjustments: -10 })], split).trim().split("\n");
    expect(lines[0]).toBe(GUSTO_HEADER.join(","));
    expect(lines[1]).toBe("Abbott,Ava,38.00,2.00,0.00,4.00,0.00,0.00,0.00,0.00,200.00,100.00,38.00,12.50");
  });

  it("quotes names with commas", () => {
    expect(squarePayrollCsv([row({ name: "Lee, Jr Sam" })])).toContain('"Lee, Jr",Sam');
  });

  it("summarizes for the accountant", () => {
    const body = accountantSummaryCsv([row()], totals, meta, split);
    expect(body).toContain("Gross wages,925.00");
    expect(body).toContain("of which overtime premium,20.00");
    expect(body).toContain("Card tips (paid through payroll),200.00");
    expect(body).toContain("Cash tips (already in hand — reported but not paid),100.00");
    expect(body).toContain("Employer taxes and burden (estimated at 12%),111.00");
  });

  it("names files by format and marks drafts", () => {
    expect(exportFile("GUSTO", [row()], totals, meta).filename).toBe("gusto-hours-2026-11-09-to-2026-11-15.csv");
    expect(exportFile("GENERIC", [row()], totals, { ...meta, status: "DRAFT" }).filename).toBe("payroll-2026-11-09-to-2026-11-15-DRAFT.csv");
    expect(exportFile("GENERIC", [row()], totals, meta).body).toContain("Ava Abbott,TM1");
  });
});

describe("payroll hand-off steps", () => {
  const base: HandoffFacts = { periodEnded: true, approved: false, approvedBy: null, tipDaysUncovered: 2, tipsPooled: true, blockingIssues: 1, warnings: 0, exports: [], handedOffAt: null, handedOffBy: null, provider: "Gusto" };
  it("walks the period from open to handed off", () => {
    expect(handoffSteps(base).map((s) => s.state)).toEqual(["todo", "todo", "todo", "blocked", "blocked"]);
    expect(periodLabel(base)).toBe("Open");
    const approved = { ...base, approved: true, tipDaysUncovered: 0, blockingIssues: 0 };
    expect(handoffSteps(approved).map((s) => s.state)).toEqual(["done", "done", "done", "todo", "blocked"]);
    const exported = { ...approved, exports: [{ format: "GUSTO" as const, approved: true, at: "", by: "Max" }] };
    expect(periodLabel(exported)).toBe("Exported");
    expect(handoffSteps(exported)[4].state).toBe("todo");
    expect(periodLabel({ ...exported, handedOffAt: "x" })).toBe("Handed off");
  });
  it("skips tips when nothing is pooled and waits for the period to end", () => {
    expect(handoffSteps({ ...base, tipsPooled: false })[1].state).toBe("na");
    expect(handoffSteps({ ...base, periodEnded: false })[0].state).toBe("blocked");
  });
});

describe("covers", () => {
  it("derives covers from checks", () => {
    expect(parseGuestsPerCheck(null)).toBe(1);
    expect(parseGuestsPerCheck("2.5")).toBe(2.5);
    expect(parseGuestsPerCheck("40")).toBe(1);
    expect(coversFromChecks(10, 1.5)).toBe(15);
    expect(hourlyCovers([2, null, 4], 2)).toEqual([4, 0, 8]);
    expect(hourlyCovers(null, 2)).toBeNull();
  });
  it("works out sales and covers per labor hour", () => {
    expect(productivity(1200, 80, 20)).toEqual({ sales: 1200, covers: 80, laborHours: 20, salesPerLaborHour: 60, coversPerLaborHour: 4, perCover: 15 });
    expect(productivity(100, null, 0).salesPerLaborHour).toBeNull();
  });
  it("finds the rush", () => {
    const c = new Array(24).fill(0);
    c[18] = 20;
    c[19] = 25;
    c[20] = 10;
    expect(coverPeak(c)).toEqual({ from: 18, to: 20, covers: 45 });
    expect(coverPeak(new Array(24).fill(0))).toBeNull();
  });
});

describe("my pay this period", () => {
  it("adds finalized tips to an estimate for the hours not pooled yet", () => {
    const p = myPay({ workedHours: 20, scheduledHours: 6, finalizedTips: 150, finalizedHours: 10, recentRate: 12, tipped: true });
    expect(p.projectedHours).toBe(26);
    expect(p.tips).toEqual({ finalized: 150, estimate: 120, total: 270, basis: "mixed" });
  });
  it("shows no tips for untipped roles and needs some history to estimate", () => {
    expect(myPay({ workedHours: 20, scheduledHours: 0, finalizedTips: 0, finalizedHours: 0, recentRate: 10, tipped: false }).tips.basis).toBe("none");
    expect(recentTipRate([{ amount: 20, hours: 2 }])).toBeNull();
    expect(recentTipRate([{ amount: 60, hours: 4 }, { amount: 40, hours: 6 }])).toBe(10);
  });
});

describe("timecard hours for the staff estimate", () => {
  const now = new Date("2026-11-16T02:00:00Z");
  it("counts closed cards less breaks, open cards up to now, and ignores forgotten clock-outs", () => {
    expect(cardHours({ clockIn: new Date("2026-11-15T16:00:00Z"), clockOut: new Date("2026-11-15T22:30:00Z"), breakMinutes: 30 }, now)).toEqual({ hours: 6, stale: false });
    expect(cardHours({ clockIn: new Date("2026-11-15T22:00:00Z"), clockOut: null, breakMinutes: 0 }, now)).toEqual({ hours: 4, stale: false });
    expect(cardHours({ clockIn: new Date("2026-11-13T22:00:00Z"), clockOut: null, breakMinutes: 0 }, now)).toEqual({ hours: 0, stale: true });
  });
});
