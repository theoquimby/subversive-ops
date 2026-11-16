import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, LinkButton, PageHeader, Stat } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { payPeriodFor } from "@/domain/payroll";
import { FORMAT_META, type ExportFormat, type StepState } from "@/domain/payrollHandoff";
import { cn } from "@/lib/cn";
import { money, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { getLaborRules } from "@/server/services/labor-rules";
import { handoffView, recentPeriods } from "@/server/services/payrollHandoff";
import { businessToday } from "@/server/services/sales";
import { Check, ChevronLeft, ChevronRight, Circle, Download, Minus, Lock } from "lucide-react";
import Link from "next/link";
import { HandedOffButton } from "./handoff-client";

export const metadata = { title: "Payroll" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STEP_ICON: Record<StepState, typeof Check> = { done: Check, todo: Circle, blocked: Lock, na: Minus };
const STEP_TONE: Record<StepState, string> = { done: "bg-good text-white", todo: "bg-warn-bg text-warn", blocked: "bg-surface-2 text-muted", na: "bg-surface-2 text-muted" };

/** Payroll hand-off: where the period stands and the files for the payroll provider and accountant. Ops never runs payroll. */
export default async function PayrollHandoffPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const rules = await getLaborRules();
  const today = businessToday();
  // Default to the last finished period: that's the one being handed off.
  const current = payPeriodFor(today, rules);
  const period = payPeriodFor(sp.start && ISO.test(sp.start) ? sp.start : addDays(current.start, -1), rules);
  const [v, recent] = await Promise.all([handoffView(period), recentPeriods(6)]);
  const prev = payPeriodFor(addDays(period.start, -1), rules).start;
  const next = addDays(period.end, 1);
  const label = `${shortDate(period.start)} – ${shortDate(period.end)}`;
  const order: ExportFormat[] = v.provider.id === "GUSTO" ? ["GUSTO", "ACCOUNTANT", "GENERIC", "SQUARE_PAYROLL"] : v.provider.id === "SQUARE_PAYROLL" ? ["SQUARE_PAYROLL", "ACCOUNTANT", "GENERIC", "GUSTO"] : ["GENERIC", "ACCOUNTANT", "SQUARE_PAYROLL", "GUSTO"];
  const submitted = v.steps.find((s) => s.id === "submitted")!;

  return (
    <>
      <PageHeader
        help="labor.handoff"
        back={{ href: `/labor?start=${period.start}`, label: "Timecards" }}
        title="Payroll"
        description={`Hand the approved hours and tips to ${v.provider.name}. Payroll itself — taxes, paychecks, direct deposit — is run there, not here.`}
        actions={
          <div className="flex items-center gap-1">
            <LinkButton href={`/labor/handoff?start=${prev}`} variant="secondary" className="size-11 shrink-0 px-0 sm:size-10" aria-label="Previous pay period"><ChevronLeft className="size-5" /></LinkButton>
            <span className="num min-w-36 px-2 text-center text-sm font-medium">{label}</span>
            <LinkButton href={`/labor/handoff?start=${next}`} variant="secondary" className="size-11 shrink-0 px-0 sm:size-10" aria-label="Next pay period"><ChevronRight className="size-5" /></LinkButton>
          </div>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-8">
          <HelpZone id="labor.handoff.steps">
            <section aria-labelledby="steps-h">
              <h2 id="steps-h" className="mb-3 flex items-center gap-1.5 text-[0.95rem] font-semibold">Hand-off <Badge tone={v.label === "Handed off" ? "good" : v.label === "Open" ? "warn" : "neutral"}>{v.label}</Badge></h2>
              <Card className="divide-y divide-border">
                {v.steps.map((s, i) => {
                  const Icon = STEP_ICON[s.state];
                  return (
                    <div key={s.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", STEP_TONE[s.state])} aria-hidden><Icon className="size-3.5" strokeWidth={2.5} /></span>
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-sm font-medium", s.state === "blocked" && "text-muted")}><span className="num text-muted">{i + 1}.</span> {s.title}</div>
                        <div className="text-xs text-muted">{s.detail}</div>
                        {s.id === "hours" && s.state === "todo" && <Link href={`/labor?start=${period.start}`} className="mt-1 inline-flex min-h-9 items-center text-xs font-medium text-ink-2 underline underline-offset-2">Open timecards</Link>}
                        {s.id === "tips" && s.state === "todo" && <Link href="/tips" className="mt-1 inline-flex min-h-9 items-center text-xs font-medium text-ink-2 underline underline-offset-2">Open tips</Link>}
                      </div>
                    </div>
                  );
                })}
              </Card>
            </section>
          </HelpZone>

          <HelpZone id="labor.handoff.files">
            <section aria-labelledby="files-h">
              <h2 id="files-h" className="mb-1 flex items-center gap-1.5 text-[0.95rem] font-semibold">Files <HelpTip id="labor.handoff.files" /></h2>
              <p className="mb-3 text-sm text-muted">{v.facts.approved ? "From the approved period — these won't change." : "Hours aren't approved yet, so files are marked DRAFT."}</p>
              <Card className="divide-y divide-border">
                {order.map((f) => {
                  const m = FORMAT_META[f];
                  const last = v.facts.exports.find((e) => e.format === f);
                  return (
                    <div key={f} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{m.label}{f === v.provider.id && <Badge tone="good">Your provider</Badge>}{!m.verified && <Badge tone="warn">Column layout unverified</Badge>}</div>
                        <div className="text-xs text-muted">{m.hint}{last ? ` · last downloaded ${new Date(last.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${last.by ? ` by ${last.by}` : ""}${last.approved ? "" : " (draft)"}` : ""}</div>
                      </div>
                      <LinkButton href={`/labor/handoff/file?start=${period.start}&format=${f}`} prefetch={false} variant={f === order[0] ? "primary" : "secondary"} className="shrink-0 max-sm:h-11">
                        <Download className="size-3.5" aria-hidden /> CSV
                      </LinkButton>
                    </div>
                  );
                })}
              </Card>
              <p className="mt-2 text-xs text-muted">Square Payroll and Gusto layouts follow their hours-import templates but couldn&apos;t be checked against their help pages when this was built. Compare the first file with the template in {v.provider.name} before importing; the “Every column” file always works for typing hours in by hand.</p>
            </section>
          </HelpZone>

          <section aria-labelledby="ppl-h">
            <h2 id="ppl-h" className="mb-3 text-[0.95rem] font-semibold">Per person</h2>
            {v.rows.length === 0 ? (
              <Card className="px-4 py-5 text-sm text-muted">Nobody worked or was paid in this period.</Card>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="border-b border-border px-3 py-2 text-left font-medium">Name</th>
                      <th className="border-b border-border px-3 py-2 text-right font-medium">Hours</th>
                      <th className="hidden border-b border-border px-3 py-2 text-right font-medium sm:table-cell">OT</th>
                      <th className="border-b border-border px-3 py-2 text-right font-medium">Gross</th>
                      <th className="hidden border-b border-border px-3 py-2 text-right font-medium sm:table-cell">Tips</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.rows.map((r) => (
                      <tr key={r.employeeId} className="[&:last-child>td]:border-b-0">
                        <td className="border-b border-border px-3 py-2">{r.name}{r.missingRate && <span className="ml-1.5 text-xs text-bad">no rate</span>}{!r.squareTeamMemberId && v.provider.id === "SQUARE_PAYROLL" && <span className="ml-1.5 text-xs text-warn">not linked to Square</span>}</td>
                        <td className="num border-b border-border px-3 py-2 text-right">{qty(r.regularHours + r.overtimeHours, 2)}</td>
                        <td className="num hidden border-b border-border px-3 py-2 text-right sm:table-cell">{r.overtimeHours ? qty(r.overtimeHours, 2) : "—"}</td>
                        <td className="num border-b border-border px-3 py-2 text-right">{money(r.gross)}</td>
                        <td className="num hidden border-b border-border px-3 py-2 text-right sm:table-cell">{money(r.tips)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <Stat label="Gross wages" value={money(v.totals.gross, { whole: true })} hint={`${qty(v.totals.hours, 1)} h · ${qty(v.totals.overtimeHours, 1)} OT`} />
            <Stat label="Tips" value={money(v.totals.tips, { whole: true })} hint="from finalized pools" />
          </div>
          <Card className="p-4">
            <div className="text-sm font-medium">{submitted.title}</div>
            <p className="mt-1 text-xs text-muted">{submitted.detail}</p>
            <div className="mt-3 flex flex-col gap-2">
              <HandedOffButton start={period.start} done={!!v.facts.handedOffAt} enabled={v.facts.approved} provider={v.provider.name} />
              {v.provider.url && <a href={v.provider.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium text-ink-2 active:bg-surface-2">Open {v.provider.name}</a>}
            </div>
          </Card>
          <HelpZone id="labor.handoff.history">
            <section aria-labelledby="hist-h">
              <h2 id="hist-h" className="mb-3 text-[0.95rem] font-semibold">Recent periods</h2>
              <Card className="divide-y divide-border">
                {recent.map((p) => (
                  <Link key={p.start} href={`/labor/handoff?start=${p.start}`} className={cn("flex min-h-11 items-center justify-between gap-2 px-4 py-2 text-sm active:bg-surface-2", p.start === period.start && "bg-surface-2/60")}>
                    <span className="num">{shortDate(p.start)} – {shortDate(p.end)}</span>
                    <Badge tone={p.label === "Handed off" ? "good" : p.label === "Open" ? (p.end < today ? "warn" : "neutral") : "neutral"}>{p.end >= today && p.label === "Open" ? "In progress" : p.label}</Badge>
                  </Link>
                ))}
              </Card>
            </section>
          </HelpZone>
          <p className="text-xs text-muted">Provider and its link are set on <Link href="/team/onboarding" className="underline underline-offset-2">Team → Onboarding</Link>.</p>
        </div>
      </div>
    </>
  );
}
