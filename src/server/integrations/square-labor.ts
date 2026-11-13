import "server-only";
import { env } from "../env";

/**
 * Square Labor reads: team members, their wage settings, and timecards.
 * Square renamed "shifts" to "timecards" in 2025; older API versions only
 * have /labor/shifts/search, so we fall back to it on a 404.
 */

const SQUARE_VERSION = "2025-10-16";

const baseUrl = () =>
  env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";

export class SquareLaborError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as { errors?: { detail?: string }[] }).errors?.map((e) => e.detail).join("; ");
    throw new SquareLaborError(`Square ${res.status}: ${detail || res.statusText}`, res.status);
  }
  return body as T;
}

interface Money { amount?: number }

// ---- Team members ------------------------------------------------------------

export interface SquareTeamMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
}

export async function listTeamMembers(): Promise<SquareTeamMember[]> {
  const out: SquareTeamMember[] = [];
  let cursor: string | undefined;
  do {
    const page = await call<{
      team_members?: { id: string; given_name?: string; family_name?: string; email_address?: string; phone_number?: string; status?: string }[];
      cursor?: string;
    }>("/team-members/search", {
      method: "POST",
      body: JSON.stringify({ query: { filter: { location_ids: [env.SQUARE_LOCATION_ID] } }, limit: 200, cursor }),
    });
    for (const m of page.team_members ?? []) {
      out.push({
        id: m.id,
        name: [m.given_name, m.family_name].filter(Boolean).join(" ") || "Team member",
        email: m.email_address ?? null,
        phone: m.phone_number ?? null,
        active: m.status !== "INACTIVE",
      });
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

export interface SquareJob {
  title: string;
  hourlyRate: number | null; // dollars
}

/** Hourly job assignments for one team member (salaried jobs have no hourly rate). */
export async function getWageJobs(teamMemberId: string): Promise<SquareJob[]> {
  try {
    const r = await call<{ wage_setting?: { job_assignments?: { job_title?: string; pay_type?: string; hourly_rate?: Money }[] } }>(
      `/team-members/${encodeURIComponent(teamMemberId)}/wage-setting`,
    );
    return (r.wage_setting?.job_assignments ?? []).map((j) => ({
      title: j.job_title?.trim() || "Staff",
      hourlyRate: j.pay_type === "HOURLY" && j.hourly_rate?.amount != null ? j.hourly_rate.amount / 100 : null,
    }));
  } catch (e) {
    // Team members without wage settings return 404.
    if (e instanceof SquareLaborError && e.status === 404) return [];
    throw e;
  }
}

// ---- Timecards ---------------------------------------------------------------

export interface SquareTimecard {
  id: string;
  teamMemberId: string;
  startAt: string;
  endAt: string | null;
  unpaidBreakMinutes: number;
  jobTitle: string | null;
  hourlyRate: number | null;
}

interface RawTimecard {
  id: string;
  team_member_id?: string;
  employee_id?: string;
  start_at: string;
  end_at?: string;
  breaks?: { start_at?: string; end_at?: string; is_paid?: boolean }[];
  wage?: { title?: string; hourly_rate?: Money };
}

function normalize(t: RawTimecard): SquareTimecard | null {
  const teamMemberId = t.team_member_id ?? t.employee_id;
  if (!teamMemberId) return null;
  let unpaid = 0;
  for (const b of t.breaks ?? []) {
    if (b.is_paid || !b.start_at || !b.end_at) continue;
    unpaid += Math.max(0, (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60_000);
  }
  return {
    id: t.id,
    teamMemberId,
    startAt: t.start_at,
    endAt: t.end_at ?? null,
    unpaidBreakMinutes: Math.round(unpaid),
    jobTitle: t.wage?.title?.trim() || null,
    hourlyRate: t.wage?.hourly_rate?.amount != null ? t.wage.hourly_rate.amount / 100 : null,
  };
}

/** Timecards that started in [startISO, endISO). */
export async function listTimecards(startISO: string, endISO: string): Promise<SquareTimecard[]> {
  try {
    return await searchTimecards("/labor/timecards/search", "timecards", startISO, endISO);
  } catch (e) {
    if (e instanceof SquareLaborError && e.status === 404) return searchTimecards("/labor/shifts/search", "shifts", startISO, endISO);
    throw e;
  }
}

async function searchTimecards(path: string, key: "timecards" | "shifts", startISO: string, endISO: string) {
  const out: SquareTimecard[] = [];
  let cursor: string | undefined;
  do {
    const page = await call<{ timecards?: RawTimecard[]; shifts?: RawTimecard[]; cursor?: string }>(path, {
      method: "POST",
      body: JSON.stringify({
        query: { filter: { location_ids: [env.SQUARE_LOCATION_ID], start: { start_at: startISO, end_at: endISO } }, sort: { field: "START_AT", order: "ASC" } },
        limit: 200,
        cursor,
      }),
    });
    for (const t of page[key] ?? []) {
      const n = normalize(t);
      if (n) out.push(n);
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}
