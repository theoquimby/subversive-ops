import { describe, expect, it } from "vitest";
import { teamStory, type TeamPerson } from "../teamStory";

const person = (x: Partial<TeamPerson> = {}): TeamPerson => ({ id: "p", name: "Pat", hasLogin: true, certs: "valid", docsSigned: 2, docsRequired: 2, underMinimum: false, ...x });

describe("teamStory", () => {
  // The team the critique saw: 13 people, 12 without a login, 1 expired and 1 with 3 missing certificates, 10 unsigned.
  const team = [
    person({ id: "a", name: "Ann" }),
    person({ id: "b", hasLogin: false, certs: "expired" }),
    person({ id: "c", hasLogin: false, certs: "missing", docsSigned: 0 }),
    person({ id: "d", hasLogin: false, certs: "expiring", docsSigned: 1 }),
    ...Array.from({ length: 9 }, (_, i) => person({ id: `x${i}`, hasLogin: false, docsSigned: i < 8 ? 0 : 2 })),
  ];
  const s = teamStory(team);

  it("puts certificates first, then documents, then logins, each with where to fix it", () => {
    expect(s.findings.map((f) => f.id)).toEqual(["certs", "docs", "logins"]);
    expect(s.findings[0]).toMatchObject({ tone: "bad", title: "2 people have an expired or missing certificate", href: "/team/training" });
    expect(s.findings[1]).toMatchObject({ tone: "warn", title: "10 of 13 people haven't signed every required document", href: "/team/documents" });
    expect(s.findings[2]).toMatchObject({ tone: "warn", title: "12 people have no login", href: "/team?nologin=1#people" });
  });
  it("says why documents go unsigned when it's the missing logins", () => {
    expect(s.findings[1].detail).toBe("None of them has a login, so they can't sign yet. Invite them first.");
  });
  it("leads with the worst finding and counts the rest", () => {
    expect(s.tone).toBe("bad");
    expect(s.title).toBe("2 people have an expired or missing certificate");
    expect(s.line).toBe("And 2 more things to sort out below. 1 certificate is due to expire soon.");
  });
  it("is calm when everything is in order", () => {
    const ok = teamStory([person(), person({ id: "q", certs: "not-required" })]);
    expect(ok.findings).toEqual([]);
    expect(ok.tone).toBe("good");
    expect(ok.title).toBe("Everyone is set up");
  });
  it("flags pay under the minimum first of all", () => {
    expect(teamStory([person({ underMinimum: true })]).findings[0]).toMatchObject({ id: "pay", tone: "bad", title: "1 person is paid under the minimum wage" });
  });
});
