import { ArrowRight, BookOpen, Check, Route as RouteIcon } from "lucide-react";
import Link from "next/link";
import { Card, cx, LinkButton, PageHeader, Section } from "@/components/ui";
import { HelpZone } from "@/components/help";
import { requireUser } from "@/server/auth";
import { setupChecklist } from "@/server/services/setupChecklist";
import type { SetupItem } from "@/domain/setupChecklist";

export const metadata = { title: "Setup checklist" };

export default async function ChecklistPage() {
  await requireUser("MANAGER");
  const c = await setupChecklist();
  const essentials = c.items.filter((i) => i.group === "essentials");
  const nice = c.items.filter((i) => i.group === "nice");
  const allDone = c.essentialsDone && c.nice.done === c.nice.total;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        help="welcome.checklist"
        back={{ href: "/", label: "Overview" }}
        title="Setup checklist"
        description={allDone ? "Everything's set up. Nice work." : c.essentialsDone ? "The essentials are done. The rest each turn on a little more, whenever you're ready." : "Essentials first — each one ticks itself off once it's done."}
      />

      <HelpZone id="welcome.checklist" className="mb-10">
        <Section title={<span className="flex items-center gap-2">Essentials <span className="num text-sm font-normal text-muted">{c.essentials.done} of {c.essentials.total}</span></span>} description="Without these the numbers are empty or guessed.">
          <List items={essentials} next={c.next?.id} />
        </Section>
      </HelpZone>

      <Section title={<span className="flex items-center gap-2">Nice to have <span className="num text-sm font-normal text-muted">{c.nice.done} of {c.nice.total}</span></span>} description="Each one turns on something extra.">
        <List items={nice} next={c.essentialsDone ? c.next?.id : undefined} />
      </Section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/help/app.quickStart" className="rounded-xl border border-border bg-surface p-4">
          <BookOpen className="size-5 text-muted" strokeWidth={1.75} />
          <div className="mt-2 text-sm font-medium">Your first week</div>
          <p className="mt-0.5 text-sm text-muted">The ten things worth doing this week, in order.</p>
        </Link>
        <Link href="/welcome" className="rounded-xl border border-border bg-surface p-4">
          <RouteIcon className="size-5 text-muted" strokeWidth={1.75} />
          <div className="mt-2 text-sm font-medium">Step-by-step setup</div>
          <p className="mt-0.5 text-sm text-muted">The guided first-run: business basics, suppliers, your data and logins.</p>
        </Link>
      </div>
    </div>
  );
}

function List({ items, next }: { items: SetupItem[]; next?: string }) {
  return (
    <Card className="divide-y divide-border">
      {items.map((i) => (
        <div key={i.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <span
            aria-label={i.done ? "Done" : "Not done yet"}
            className={cx("grid size-7 shrink-0 place-items-center rounded-full", i.done ? "bg-good-bg text-good" : "border border-dashed border-border-strong text-muted")}
          >
            {i.done && <Check className="size-4" strokeWidth={2.5} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className={cx("text-[0.95rem] font-medium", i.done ? "text-ink-2" : "text-ink")}>{i.title}</div>
            <div className="text-sm text-muted">
              {i.why}
              {i.detail && <span className="text-ink-2"> · {i.detail}</span>}
              {!i.done && <span className="hidden sm:inline"> · about {i.minutes} min</span>}
            </div>
          </div>
          {i.done ? (
            <LinkButton href={i.href} variant="ghost" size="sm" className="h-10 shrink-0 sm:h-8">Open</LinkButton>
          ) : (
            <LinkButton href={i.href} variant={i.id === next ? "primary" : "secondary"} size="sm" className="h-10 shrink-0 sm:h-8">
              Do it <ArrowRight className="size-3.5" strokeWidth={2} />
            </LinkButton>
          )}
        </div>
      ))}
    </Card>
  );
}
