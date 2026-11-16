import { describe, expect, it } from "vitest";
import { loginAllowed } from "../loginAccess";

describe("loginAllowed", () => {
  it("blocks staff whose employee record is switched off", () => {
    expect(loginAllowed("STAFF", false)).toBe(false);
  });
  it("lets staff with an active employee record, or none linked, sign in", () => {
    expect(loginAllowed("STAFF", true)).toBe(true);
    expect(loginAllowed("STAFF", null)).toBe(true);
  });
  it("never locks a manager out because of the employee record", () => {
    expect(loginAllowed("MANAGER", false)).toBe(true);
  });
});
