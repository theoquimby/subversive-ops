import { HelpTip, HelpZone } from "@/components/help";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { shiftLabel } from "@/domain/schedule";
import { greeting, relativeDay, type QuickAction } from "@/domain/staffHome";
import { cn } from "@/lib/cn";
import { areaStyle, type Area } from "@/lib/areas";
import { dayDate, money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { pushReady, vapidPublicKey } from "@/server/services/push";
import { employeeForUser } from "@/server/services/scheduling";
import { staffHome, type HomeShift } from "@/server/services/staffHome";
import { canOrder } from "@/server/services/supplierPrefs";
import { myPayThisPeriod, type MyPayView } from "@/server/services/myPay";
import { getRecognitionConfig, recentShoutouts } from "@/server/services/recognition";
import { AlertTriangle, ArrowLeftRight, Beer, CalendarCheck, ChefHat, ChevronRight, CircleCheck, ClipboardList, FileSignature, GraduationCap, Hand, ListChecks, Megaphone, MessageCircle, NotebookPen, PartyPopper, Pin, ScanLine, Sparkles, Trash2, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { ShiftCountdown } from "./countdown";
import { HomeSetup } from "./home-setup";

export const metadata = { title: "Today" };

const ACTIONS: Record<QuickAction, { label: string; href: string; icon: LucideIcon; area: Area }> = {
  scan: { label: "Scan a keg", href: "/kegs/scan", icon: ScanLine, area: "floor" },
  taps: { label: "Tap list", href: "/kegs/taps", icon: Beer, area: "floor" },
  prep: { label: "Prep list", href: "/prep", icon: ChefHat, area: "food" },
  waste: { label: "Log waste", href: "/waste", icon: Trash2, area: "floor" },
  count: { label: "Start a count", href: "/count", icon: ClipboardList, area: "numbers" },
  note: { label: "Shift note", href: "/notes", icon: NotebookPen, area: "today" },
};

const TODO_ICON = { sign: FileSignature, cert: AlertTriangle, training: GraduationCap, swap: ArrowLeftRight, open: Hand } as const;

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

export default async function TodayPage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  if (!me) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-7">
        <PageHeader help="my.today" title="Today" />
        <EmptyState title={`Hi ${session.name} — you're not on the schedule yet`}>
          {session.role === "MANAGER"
            ? "Your login isn't linked to a team member. Link it on the Team page and your shifts, open shifts and time off show up here."
            : "Your login isn't linked to a team member. Ask a manager to connect it on the Team page, then your shifts, open shifts and time off will show up here."}
        </EmptyState>
        <QuickActions order={["scan", "prep", "waste", "count", "note", "taps"]} />
      </div>
    );
  }
  const now = Date.now();
  const [home, canPush, vapid, pay, shoutouts, recog, orders] = await Promise.all([
    staffHome(me, new Date(now)),
    pushReady(),
    vapidPublicKey(),
    myPayThisPeriod(me.id, new Date(now)).catch(() => null),
    recentShoutouts({ days: 14, limit: 3 }).catch(() => []),
    getRecognitionConfig(),
    // Staff a manager allowed to place supplier orders get a way in from here.
    session.role === "STAFF" ? canOrder(session) : Promise.resolve(false),
  ]);
  const todayLabel = new Date(`${home.today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-7">
      <HelpZone id="my.today">
        <header className="animate-rise-in motion-reduce:animate-none">
          <p className="text-sm font-medium text-muted">{todayLabel}</p>
          <h1 className="mt-0.5 text-[1.75rem] leading-tight font-semibold tracking-tight text-ink">{greeting(home.hour)}, {home.name}</h1>
        </header>
      </HelpZone>

      {home.onboarding && <OnboardingBanner o={home.onboarding} />}

      <HelpZone id="my.nextShift" tour="my.next-shift">
        {home.next ? <NextShift s={home.next} crew={home.crew} today={home.today} now={now} week={home.week} /> : <NoShift />}
      </HelpZone>

      <HelpZone id="my.quick" tour="my.quick">
        <QuickActions order={home.actions} />
      </HelpZone>

      {orders && (
        <Link href="/my/ordering" className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-2/60">
          <span><span className="block font-medium text-ink">Supplier orders</span><span className="block text-sm text-muted">Check and send the orders that are due</span></span>
          <ChevronRight className="size-5 text-muted" aria-hidden />
        </Link>
      )}

      <HelpZone id="my.todo" tour="my.todo">
        <section aria-labelledby="todo-h">
          <h2 id="todo-h" className="mb-2.5 flex items-center gap-1.5 px-1 text-[0.95rem] font-semibold">
            For you {home.todos.length > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-warn-bg px-1.5 text-xs text-warn">{home.todos.length}</span>}
            <HelpTip id="my.todo" />
          </h2>
          {home.todos.length === 0 ? (
            <Card className="flex items-center gap-3 px-4 py-4 text-sm">
              <CircleCheck className="size-5 shrink-0 text-good" aria-hidden />
              <span><span className="font-medium text-ink">You&apos;re all caught up.</span> <span className="text-muted">Nothing to sign, upload or answer.</span></span>
            </Card>
          ) : (
            <Card className="divide-y divide-border overflow-hidden">
              {home.todos.map((t, i) => {
                const Icon = TODO_ICON[t.kind];
                return (
                  <Link key={i} href={t.href} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors duration-120 active:bg-surface-2">
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", t.tone === "bad" ? "bg-bad-bg text-bad" : t.tone === "warn" ? "bg-warn-bg text-warn" : "bg-surface-2 text-ink-2")} aria-hidden>
                      <Icon className="size-[1.15rem]" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.95rem] leading-snug font-medium text-ink">{t.title}</span>
                      <span className="mt-0.5 block truncate text-[0.8rem] text-muted">{t.detail}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                );
              })}
            </Card>
          )}
          {home.waiting.length > 0 && (
            <p className="mt-2 px-1 text-[0.8rem] text-muted">
              Waiting on a manager: {home.waiting.join(" · ")}. <Link href="/my/shifts" className="font-medium text-ink-2 underline underline-offset-2">See them</Link>
            </p>
          )}
        </section>
      </HelpZone>

      {pay && <PayCard pay={pay} />}

      <HomeSetup pushReady={canPush} vapidKey={vapid} />

      {shoutouts.length > 0 && (
        <HelpZone id="my.shoutouts">
          <section aria-labelledby="shout-h">
            <h2 id="shout-h" className="mb-2.5 flex items-center justify-between gap-1.5 px-1 text-[0.95rem] font-semibold">
              <span className="flex items-center gap-1.5"><Sparkles className="size-4 text-muted" aria-hidden /> Shout-outs</span>
              <Link href="/my/kudos" className="inline-flex min-h-10 items-center text-sm font-medium text-ink-2">{recog.peerShoutouts ? "Thank someone" : "See all"}</Link>
            </h2>
            <Card className="divide-y divide-border">
              {shoutouts.map((s) => (
                <article key={s.id} className="px-4 py-3.5">
                  <p className="text-[0.95rem] leading-snug text-ink"><span className="font-medium">{s.to.split(" ")[0]}</span> — {s.body}</p>
                  <p className="mt-1 text-xs text-muted">{s.value ? `${s.value} · ` : ""}{s.from} · {when(s.createdAt)}</p>
                </article>
              ))}
            </Card>
          </section>
        </HelpZone>
      )}

      {home.kudos && (
        <section aria-label="Kudos" className="relative overflow-hidden rounded-2xl border border-good/25 bg-good-bg px-4 py-4">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-good uppercase"><Sparkles className="size-3.5" aria-hidden /> Kudos</div>
          <p className="mt-1.5 text-[0.95rem] leading-snug text-ink">{home.kudos.body}</p>
          <p className="mt-1.5 text-xs text-muted">{home.kudos.author ?? "Your manager"} · {when(home.kudos.createdAt)}</p>
        </section>
      )}

      {home.announcements.length > 0 && (
        <HelpZone id="my.announcements">
          <section aria-labelledby="news-h">
            <h2 id="news-h" className="mb-2.5 flex items-center gap-1.5 px-1 text-[0.95rem] font-semibold"><Megaphone className="size-4 text-muted" aria-hidden /> From the team</h2>
            <Card className="divide-y divide-border">
              {home.announcements.map((a) => (
                <article key={a.id} className="px-4 py-3.5">
                  <p className="text-[0.95rem] leading-snug whitespace-pre-line text-ink">{a.body}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted">{a.pinned && <><Pin className="size-3" aria-label="Pinned" /> </>}{a.author ?? "Manager"} · {when(a.createdAt)}</p>
                </article>
              ))}
            </Card>
          </section>
        </HelpZone>
      )}

      <MoreForYou onboarding={!!home.onboarding} />

      <p className="pb-2 text-center text-sm text-muted">
        New here? <Link href="/my?tour=today" className="inline-flex min-h-11 items-center font-medium text-ink-2 underline underline-offset-2">Take the 1-minute tour</Link>
      </p>
    </div>
  );
}

function NextShift({ s, crew, today, now, week }: { s: HomeShift; crew: Awaited<ReturnType<typeof staffHome>>["crew"]; today: string; now: number; week: { shifts: number; hours: number } }) {
  const day = relativeDay(s.date, today) ?? dayDate(s.date);
  const shown = crew.slice(0, 5);
  return (
    <section aria-label="Your next shift" className="overflow-hidden rounded-[1.4rem] bg-[#1b1a18] text-[#f7f7f5] shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)] dark:bg-[#22221f] dark:ring-1 dark:ring-white/10">
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[0.8rem] font-medium opacity-70">{day === "Today" || day === "Tomorrow" ? `${day} · ${shortDate(s.date)}` : day}</p>
          <p className="num mt-1 text-[1.6rem] leading-none font-semibold tracking-tight">{shiftLabel(s.startMin, s.endMin)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-sm">
            <span className="size-2 shrink-0 rounded-full ring-2 ring-white/15" style={{ background: s.color }} aria-hidden />
            <span className="truncate">{s.position}</span>
            <span className="opacity-60">· {Number(s.hours.toFixed(1))}h</span>
          </p>
        </div>
        <ShiftCountdown startAt={s.startAt} endAt={s.endAt} serverNow={now} className="shrink-0 pt-0.5" />
      </div>
      {s.notes && <p className="mx-5 mt-3 rounded-xl bg-white/8 px-3 py-2 text-sm">{s.notes}</p>}
      {s.swapPending && <p className="mx-5 mt-3 rounded-xl bg-[#ffb35c]/15 px-3 py-2 text-sm text-[#ffcf94]">You&apos;ve asked to swap this one — it&apos;s yours until a manager approves.</p>}
      <div className="mt-4 border-t border-white/10 px-5 py-3.5">
        {crew.length === 0 ? (
          <p className="text-sm opacity-70">No one else is on the schedule with you yet.</p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 -space-x-1.5" aria-hidden>
              {shown.map((c) => (
                <span key={`${c.name}-${c.startMin}`} className="grid size-8 place-items-center rounded-full text-[0.7rem] font-semibold text-white ring-2 ring-[#1b1a18] dark:ring-[#22221f]" style={{ background: `color-mix(in oklab, ${c.color} 72%, black)` }}>
                  {c.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("")}
                </span>
              ))}
            </div>
            <p className="min-w-0 text-sm leading-snug">
              <span className="opacity-70">On with you: </span>
              {shown.map((c, i) => <span key={`${c.name}-${c.startMin}`}>{i > 0 && ", "}{c.name.split(" ")[0]} <span className="opacity-60">({c.position.toLowerCase()})</span></span>)}
              {crew.length > shown.length && <span className="opacity-70"> +{crew.length - shown.length} more</span>}
            </p>
          </div>
        )}
      </div>
      <Link href="/my/shifts" className="flex min-h-12 items-center justify-between gap-3 bg-white/[0.06] px-5 text-sm font-medium transition-colors duration-120 active:bg-white/10">
        <span className="flex items-center gap-2"><CalendarCheck className="size-4 opacity-80" aria-hidden /> All my shifts</span>
        <span className="flex items-center gap-1 opacity-70"><span className="num">{week.shifts} in 7 days · {Number(week.hours.toFixed(1))}h</span><ChevronRight className="size-4" aria-hidden /></span>
      </Link>
    </section>
  );
}

function OnboardingBanner({ o }: { o: NonNullable<Awaited<ReturnType<typeof staffHome>>["onboarding"]> }) {
  const pct = o.total ? Math.round((o.done / o.total) * 100) : 0;
  return (
    <HelpZone id="my.onboarding">
      <Link href="/my/onboarding" className="block rounded-2xl border border-border bg-surface px-4 py-4 transition-colors duration-120 active:bg-surface-2">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-good-bg text-good" aria-hidden><PartyPopper className="size-5" strokeWidth={1.9} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.95rem] font-medium text-ink">{o.seen ? "Your first-week checklist" : "Welcome aboard! Start here"}</span>
            <span className="block text-[0.8rem] text-muted">{o.requiredLeft ? `${o.requiredLeft} thing${o.requiredLeft === 1 ? "" : "s"} left${o.dueOn ? ` · by ${shortDate(o.dueOn)}` : ""}` : "All the must-dos are done"}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist progress">
          <div className="h-full rounded-full bg-good transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </Link>
    </HelpZone>
  );
}

function PayCard({ pay }: { pay: MyPayView }) {
  return (
    <HelpZone id="my.pay">
      <Link href="/my/pay" className="block rounded-2xl border border-border bg-surface px-4 py-3.5 transition-colors duration-120 active:bg-surface-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.8rem] font-medium text-muted">This pay period · {shortDate(pay.period.start)} – {shortDate(pay.period.end)}</span>
          <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          <div>
            <div className="num text-xl font-semibold text-ink">{Number(pay.workedHours.toFixed(1))}h</div>
            <div className="text-xs text-muted">worked{pay.scheduledHours ? ` · ${Number(pay.scheduledHours.toFixed(1))}h to go` : ""}</div>
          </div>
          {pay.tips.basis !== "none" && (
            <div>
              <div className="num text-xl font-semibold text-ink">{money(pay.tips.total, { whole: true })}</div>
              <div className="text-xs text-muted">tips{pay.tips.basis === "finalized" ? "" : " · estimate"}</div>
            </div>
          )}
        </div>
      </Link>
    </HelpZone>
  );
}

const MORE: { href: string; label: string; icon: LucideIcon; onboarding?: boolean }[] = [
  { href: "/my/onboarding", label: "My checklist", icon: ListChecks, onboarding: true },
  { href: "/my/pay", label: "Hours & tips", icon: Wallet },
  { href: "/my/kudos", label: "Shout-outs", icon: Sparkles },
  { href: "/my/message", label: "Message a manager", icon: MessageCircle },
  { href: "/my/me#documents", label: "Documents", icon: FileSignature },
  { href: "/my/me#training", label: "Training & certificates", icon: GraduationCap },
];

function MoreForYou({ onboarding }: { onboarding: boolean }) {
  return (
    <HelpZone id="my.more">
      <nav aria-labelledby="more-h">
        <h2 id="more-h" className="mb-2.5 px-1 text-[0.95rem] font-semibold">More for you</h2>
        <Card className="divide-y divide-border overflow-hidden">
          {MORE.filter((m) => !m.onboarding || onboarding).map((m) => (
            <Link key={m.href} href={m.href} className="flex min-h-13 items-center gap-3 px-4 py-2.5 text-[0.95rem] transition-colors duration-120 active:bg-surface-2">
              <m.icon className="size-[1.1rem] shrink-0 text-muted" strokeWidth={1.9} aria-hidden />
              <span className="flex-1 text-ink">{m.label}</span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          ))}
        </Card>
      </nav>
    </HelpZone>
  );
}

function NoShift() {
  return (
    <Card className="px-5 py-6 text-center">
      <CalendarCheck className="mx-auto size-6 text-muted" aria-hidden />
      <p className="mt-2 font-medium text-ink">No shifts on the schedule yet</p>
      <p className="mt-1 text-sm text-muted">When your manager publishes the schedule, your next shift shows here with a countdown.</p>
      <LinkButton href="/my/shifts#open" size="lg" className="mt-4">See open shifts</LinkButton>
    </Card>
  );
}

function QuickActions({ order }: { order: QuickAction[] }) {
  return (
    <nav aria-label="Quick actions">
      <h2 className="mb-2.5 px-1 text-[0.95rem] font-semibold">Quick actions</h2>
      <div className="grid grid-cols-3 gap-2.5">
        {order.map((k) => {
          const a = ACTIONS[k];
          const Icon = a.icon;
          return (
            <Link
              key={k}
              href={a.href}
              style={areaStyle(a.area)}
              className="flex h-[5.75rem] flex-col justify-between rounded-2xl border border-border bg-surface p-3 transition-[transform,background-color,border-color] duration-120 ease-motion active:scale-[0.96] active:bg-surface-2 motion-reduce:active:scale-100"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-area/12 text-area"><Icon className="size-5" strokeWidth={1.9} aria-hidden /></span>
              <span className="text-[0.85rem] leading-tight font-medium text-ink">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
