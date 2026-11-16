/**
 * Overview "Needs you" items from the floor and the brewery: last night's
 * closing lists left unfinished, upkeep jobs overdue, equipment down for
 * repair, and beer tax returns due. Pure; services/attention.ts adds them to
 * the rest of the list (and so to the morning brief).
 */

import type { AttentionItem } from "./attention";
import { FORM_INFO, type DueReturn } from "./beerTax";
import type { LastNight } from "./checklists";
import { daysBetween, ISODate } from "./dates";

export interface OpsAttentionInput {
  today: ISODate;
  closes: LastNight[];
  overdueJobs: { id: string; title: string; due: ISODate | null }[];
  down: { title: string; equipment: string | null; since: ISODate }[];
  taxes: DueReturn[];
}

const list = (names: string[], max = 2) => (names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} +${names.length - max} more`);

export function opsAttentionItems(i: OpsAttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (i.closes.length) {
    const untouched = i.closes.filter((c) => c.done === 0).length;
    out.push({
      key: "checklists",
      title: i.closes.length === 1 ? `Last night's “${i.closes[0].name}” wasn't finished` : `${i.closes.length} closing lists weren't finished last night`,
      detail: i.closes.length === 1 ? (i.closes[0].done === 0 ? "Nothing was ticked" : `${i.closes[0].done} of ${i.closes[0].total} ticked, not signed off`) : untouched ? `${untouched} with nothing ticked` : list(i.closes.map((c) => c.name)),
      href: "/checklists#history",
      tone: "warn",
      urgency: 55,
    });
  }
  if (i.overdueJobs.length) {
    const worst = Math.max(...i.overdueJobs.map((j) => (j.due ? daysBetween(j.due, i.today) : 0)));
    out.push({
      key: "upkeep",
      title: i.overdueJobs.length === 1 ? `${i.overdueJobs[0].title} is overdue` : `${i.overdueJobs.length} upkeep jobs overdue`,
      detail: i.overdueJobs.length === 1 ? `${worst} day${worst === 1 ? "" : "s"} late` : list(i.overdueJobs.map((j) => j.title)),
      href: "/upkeep",
      tone: worst >= 7 ? "bad" : "warn",
      urgency: 40 + Math.min(worst, 20),
    });
  }
  if (i.down.length) {
    const d = i.down[0];
    out.push({
      key: "upkeep.down",
      title: i.down.length === 1 ? `${d.equipment ?? d.title} is down` : `${i.down.length} things waiting on a repair`,
      detail: i.down.length === 1 ? `${d.title} · since ${daysBetween(d.since, i.today) === 0 ? "today" : `${daysBetween(d.since, i.today)}d ago`}` : list(i.down.map((x) => x.equipment ?? x.title)),
      href: "/upkeep",
      tone: "bad",
      urgency: 70,
    });
  }
  // One item per return; two periods both late read "Q2 2026 and Q3 2026".
  const forms = [...new Set(i.taxes.map((t) => t.form))];
  for (const form of forms) {
    const rows = i.taxes.filter((t) => t.form === form).sort((a, b) => a.due.localeCompare(b.due));
    const t = rows[0];
    const days = daysBetween(i.today, t.due);
    out.push({
      key: `beertax.${form}`,
      title: `${FORM_INFO[form].short} for ${rows.map((r) => r.period.label).join(" and ")}`,
      detail: t.state === "overdue" ? `Was due ${-days === 1 ? "yesterday" : `${-days} days ago`}` : days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`,
      href: `/beer-tax?form=${form}`,
      tone: t.state === "overdue" || days <= 2 ? "bad" : "warn",
      urgency: t.state === "overdue" ? 80 : 50 - days,
    });
  }
  return out;
}
