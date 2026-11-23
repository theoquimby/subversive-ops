import type { CertStatus } from "./certs";

/**
 * What the Team page leads with: the people problems that need fixing, worst
 * first, each with the page where it's fixed. Positions and pay settings are
 * rarely edited, so they no longer open the page.
 */

export interface TeamPerson {
  id: string;
  name: string;
  hasLogin: boolean;
  /** Worst required certificate status. */
  certs: CertStatus | null;
  docsSigned: number;
  docsRequired: number;
  underMinimum: boolean;
}

export interface TeamFinding {
  id: "pay" | "certs" | "docs" | "logins";
  tone: "bad" | "warn";
  title: string;
  detail: string;
  href: string;
  action: string;
}

export interface TeamStory {
  tone: "good" | "warn" | "bad";
  title: string;
  line: string;
  findings: TeamFinding[];
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const has = (n: number) => (n === 1 ? "has" : "have");

/** `team`: active people only. */
export function teamStory(team: TeamPerson[]): TeamStory {
  const findings: TeamFinding[] = [];

  const under = team.filter((p) => p.underMinimum);
  if (under.length) {
    findings.push({ id: "pay", tone: "bad", title: `${people(under.length)} ${under.length === 1 ? "is" : "are"} paid under the minimum wage`, detail: under.map((p) => p.name).join(", "), href: "/team?rate=1#people", action: "Raise their rate" });
  }

  const lapsed = team.filter((p) => p.certs === "expired" || p.certs === "missing");
  if (lapsed.length) {
    findings.push({ id: "certs", tone: "bad", title: `${people(lapsed.length)} ${has(lapsed.length)} an expired or missing certificate`, detail: "They can't legally work positions that need it until it's renewed or added.", href: "/team/training", action: "Open Training" });
  }

  const withDocs = team.filter((p) => p.docsRequired > 0);
  const unsigned = withDocs.filter((p) => p.docsSigned < p.docsRequired);
  if (unsigned.length) {
    const noLogin = unsigned.filter((p) => !p.hasLogin).length;
    const detail =
      noLogin === unsigned.length ? "None of them has a login, so they can't sign yet. Invite them first."
      : noLogin ? `${noLogin} of them have no login, so they can't sign. Invite them first.`
      : "They sign from the staff app. A reminder at the next shift usually does it.";
    findings.push({ id: "docs", tone: "warn", title: `${unsigned.length} of ${people(withDocs.length)} haven't signed every required document`, detail, href: "/team/documents", action: "Open Documents" });
  }

  const noLogin = team.filter((p) => !p.hasLogin);
  if (noLogin.length) {
    findings.push({ id: "logins", tone: "warn", title: `${people(noLogin.length)} ${has(noLogin.length)} no login`, detail: "Without one they can't see their shifts, swap them or sign documents. Invite each from their row.", href: "/team?nologin=1#people", action: "Show who" });
  }

  const expiring = team.filter((p) => p.certs === "expiring").length;
  const soon = expiring ? ` ${expiring} certificate${expiring === 1 ? " is" : "s are"} due to expire soon.` : "";
  if (!findings.length) {
    return { tone: expiring ? "warn" : "good", title: "Everyone is set up", line: `Logins, certificates and documents are in order.${soon}`, findings };
  }
  const [first, ...rest] = findings;
  const more = rest.length ? `And ${rest.length} more thing${rest.length === 1 ? "" : "s"} to sort out below.` : first.detail;
  return { tone: first.tone, title: first.title, line: `${more}${soon}`, findings };
}
