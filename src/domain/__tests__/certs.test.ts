import { describe, expect, it } from "vitest";
import {
  addMonths, assignmentState, buildMatrix, certStatus, compliance, currentCert, expiryFor, nextExpiry, NY_CERT_PRESETS, personCompliant, presetPositions,
  progress, pruneReminderKeys, reminderStage, requiredFor, requiredForShift, requirementReason, validOn, withinExpiredWindow, worstStatus,
  type CertLike, type CertTypeLike,
} from "../certs";

const type = (id: string, o: Partial<CertTypeLike> = {}): CertTypeLike => ({ id, name: id, validityMonths: 36, appliesTo: [], requiredForAll: false, requiredForMinors: false, active: true, ...o });
const cert = (o: Partial<CertLike> & { certTypeId: string }): CertLike => ({ id: Math.random().toString(36).slice(2), employeeId: "e1", issuedOn: "2025-01-01", expiresOn: "2028-01-01", verified: true, ...o });

const ATAP = type("atap", { appliesTo: ["bar", "server"] });
const FOOD = type("food", { appliesTo: ["line"] });
const HARASS = type("harass", { validityMonths: 12, requiredForAll: true, isAnnualTraining: true });
const PAPERS = type("papers", { validityMonths: null, requiredForMinors: true });
const CPR = type("cpr", { validityMonths: 24 });
const TYPES = [ATAP, FOOD, HARASS, PAPERS, CPR];

describe("expiry", () => {
  it("adds months and clamps to month end", () => {
    expect(addMonths("2024-03-15", 36)).toBe("2027-03-15");
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-11-30", 3)).toBe("2026-02-28");
    expect(addMonths("2025-12-10", 12)).toBe("2026-12-10");
  });
  it("uses validity unless overridden; null validity never expires", () => {
    expect(expiryFor("2024-06-01", 36)).toBe("2027-06-01");
    expect(expiryFor("2024-06-01", 36, "2026-01-01")).toBe("2026-01-01");
    expect(expiryFor("2024-06-01", null)).toBeNull();
    expect(expiryFor("2024-06-01", 0)).toBeNull();
  });
});

describe("requirements", () => {
  it("comes from positions, everyone and the minor flag", () => {
    const bartender = { positionIds: ["bar"], isMinor: false };
    const cookMinor = { positionIds: ["line"], isMinor: true };
    expect(requiredFor(TYPES, bartender).map((t) => t.id)).toEqual(["atap", "harass"]);
    expect(requiredFor(TYPES, cookMinor).map((t) => t.id)).toEqual(["food", "harass", "papers"]);
    expect(requirementReason(HARASS, bartender)).toBe("everyone");
    expect(requirementReason(PAPERS, cookMinor)).toBe("minor");
    expect(requirementReason(ATAP, bartender)).toBe("position");
    expect(requirementReason(CPR, bartender)).toBeNull();
  });
  it("ignores inactive types", () => {
    expect(requiredFor([{ ...HARASS, active: false }], { positionIds: [], isMinor: false })).toEqual([]);
  });
  it("for a shift only looks at that position (and working papers for minors)", () => {
    expect(requiredForShift(TYPES, "line", false).map((t) => t.id)).toEqual(["food"]);
    expect(requiredForShift(TYPES, "server", true).map((t) => t.id)).toEqual(["atap", "papers"]);
  });
});

describe("status", () => {
  const today = "2026-11-13";
  it("is missing or not required without a certificate", () => {
    expect(certStatus([], true, today).status).toBe("missing");
    expect(certStatus([], false, today).status).toBe("not-required");
  });
  it("is valid, expiring within 30 days, or expired", () => {
    expect(certStatus([cert({ certTypeId: "a", expiresOn: "2027-01-01" })], true, today).status).toBe("valid");
    const soon = certStatus([cert({ certTypeId: "a", expiresOn: "2026-12-13" })], true, today);
    expect(soon.status).toBe("expiring");
    expect(soon.daysLeft).toBe(30);
    expect(certStatus([cert({ certTypeId: "a", expiresOn: today })], true, today).status).toBe("expiring");
    const gone = certStatus([cert({ certTypeId: "a", expiresOn: "2026-11-12" })], true, today);
    expect(gone.status).toBe("expired");
    expect(gone.daysLeft).toBe(-1);
  });
  it("never-expiring certificates stay valid", () => {
    expect(certStatus([cert({ certTypeId: "a", expiresOn: null })], true, today)).toMatchObject({ status: "valid", daysLeft: null });
  });
  it("a renewal wins over the old card, and future-dated cards don't count yet", () => {
    const old = cert({ certTypeId: "a", issuedOn: "2023-01-01", expiresOn: "2026-01-01" });
    const renewed = cert({ certTypeId: "a", issuedOn: "2026-10-01", expiresOn: "2029-10-01" });
    expect(currentCert([old, renewed])).toBe(renewed);
    expect(certStatus([old, renewed], true, today).status).toBe("valid");
    expect(certStatus([old, cert({ certTypeId: "a", issuedOn: "2026-12-01", expiresOn: "2029-12-01" })], true, today).status).toBe("expired");
  });
  it("checks validity on a given day", () => {
    const c = [cert({ certTypeId: "a", issuedOn: "2024-01-01", expiresOn: "2026-11-20" })];
    expect(validOn(c, "2026-11-20")).toBe(true);
    expect(validOn(c, "2026-11-21")).toBe(false);
    expect(validOn(c, "2023-12-31")).toBe(false);
    expect(validOn([], "2026-11-20")).toBe(false);
  });
});

describe("matrix and compliance", () => {
  const today = "2026-11-13";
  const people = [
    { id: "ann", positionIds: ["bar"], isMinor: false },
    { id: "bo", positionIds: ["line"], isMinor: true },
  ];
  const certs = [
    cert({ employeeId: "ann", certTypeId: "atap", expiresOn: "2026-11-30" }),
    cert({ employeeId: "ann", certTypeId: "harass", expiresOn: "2027-03-01" }),
    cert({ employeeId: "ann", certTypeId: "cpr", expiresOn: "2026-01-01" }),
    cert({ employeeId: "bo", certTypeId: "food", expiresOn: "2026-10-01" }),
    cert({ employeeId: "bo", certTypeId: "papers", expiresOn: null }),
  ];
  const m = buildMatrix(people, TYPES, certs, today);
  const cells = m.flatMap((r) => Object.values(r.cells));

  it("rolls up only required cells", () => {
    expect(m[0].cells.atap.status).toBe("expiring");
    expect(m[0].cells.cpr).toMatchObject({ status: "expired", required: false });
    expect(m[1].cells.harass.status).toBe("missing");
    const s = compliance(cells);
    expect(s).toEqual({ required: 5, ok: 3, expiring: 1, expired: 1, missing: 1, pct: 3 / 5 });
    expect(compliance([]).pct).toBeNull();
  });
  it("per person", () => {
    expect(personCompliant(Object.values(m[0].cells))).toBe(true);
    expect(personCompliant(Object.values(m[1].cells))).toBe(false);
    expect(worstStatus(Object.values(m[0].cells))).toBe("expiring");
    expect(worstStatus(Object.values(m[1].cells))).toBe("expired");
    expect(worstStatus([])).toBe("not-required");
  });
  it("finds the next expiry among certificates still in date", () => {
    expect(nextExpiry(cells)).toBe("2026-11-30");
    expect(nextExpiry(Object.values(m[1].cells))).toBeNull();
  });
});

describe("reminders", () => {
  it("picks the most urgent stage reached", () => {
    expect(reminderStage("2027-01-01", "2026-11-13")).toBeNull();
    expect(reminderStage("2026-12-13", "2026-11-13")).toBe("30");
    expect(reminderStage("2026-11-20", "2026-11-13")).toBe("7");
    expect(reminderStage("2026-11-13", "2026-11-13")).toBe("7");
    expect(reminderStage("2026-11-12", "2026-11-13")).toBe("expired");
    expect(reminderStage(null, "2026-11-13")).toBeNull();
  });
  it("prunes keys for certificates that are gone and limits expired nags", () => {
    expect(pruneReminderKeys(["a:30", "b:7", "c:expired"], new Set(["a", "c"]))).toEqual(["a:30", "c:expired"]);
    expect(withinExpiredWindow("2026-11-01", "2026-11-13")).toBe(true);
    expect(withinExpiredWindow("2026-10-01", "2026-11-13")).toBe(false);
  });
});

describe("checklists", () => {
  const today = "2026-11-13";
  it("knows where an assignment stands", () => {
    expect(assignmentState({ dueOn: null, signedOffAt: null }, 0, 5, today)).toBe("not-started");
    expect(assignmentState({ dueOn: "2026-11-20", signedOffAt: null }, 2, 5, today)).toBe("in-progress");
    expect(assignmentState({ dueOn: "2026-11-10", signedOffAt: null }, 2, 5, today)).toBe("overdue");
    expect(assignmentState({ dueOn: "2026-11-10", signedOffAt: null }, 5, 5, today)).toBe("ready");
    expect(assignmentState({ dueOn: null, signedOffAt: new Date() }, 3, 5, today)).toBe("signed-off");
    expect(progress(3, 6)).toBe(0.5);
    expect(progress(0, 0)).toBe(1);
  });
});

describe("NY presets", () => {
  const positions = [
    { id: "s", name: "Server", area: "FOH" },
    { id: "b", name: "Bartender", area: "BAR" },
    { id: "l", name: "Line cook", area: "BOH" },
    { id: "d", name: "Dishwasher", area: "BOH" },
    { id: "x", name: "Expo", area: "FOH" },
  ];
  const by = (n: string) => NY_CERT_PRESETS.find((p) => p.name.startsWith(n))!;
  it("map onto the business's positions", () => {
    expect(presetPositions(by("ATAP"), positions)).toEqual(["s", "b"]);
    expect(presetPositions(by("ServSafe Food Handler"), positions)).toEqual(["l", "d"]);
    expect(presetPositions(by("First aid"), positions)).toEqual([]);
    expect(presetPositions(by("ServSafe Food Protection"), positions)).toEqual([]);
  });
  it("cover harassment training for everyone and working papers for minors", () => {
    expect(by("Sexual harassment")).toMatchObject({ requiredForAll: true, isAnnualTraining: true, validityMonths: 12 });
    expect(by("Working papers")).toMatchObject({ requiredForMinors: true, validityMonths: null });
  });
});
