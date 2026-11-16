import { Card, Dot, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { tanksFloor } from "@/server/services/brewery";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { TanksDownNote } from "./tanks-down";
import { TanksView } from "./tanks-view";

export const metadata = { title: "Brewery" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function Page() {
  await requireUser("MANAGER");
  const f = await tanksFloor();
  const header = (
    <PageHeader
      help="brewery.tanks"
      title="Tanks"
      description="What needs doing in the cellar, then every tank as a list or where it stands on the floor: what's in it, how far along, and what's next."
      actions={f.tanks.length ? <LinkButton href="/brewery/schedule#plan" variant="primary"><Plus className="size-4" />Plan a brew</LinkButton> : undefined}
    />
  );
  if (!f.tanks.length) {
    return (
      <>
        {header}
        <EmptyState title="No tanks yet" action={<LinkButton href="/brewery/setup" variant="primary">Add your tanks</LinkButton>}>
          Add your fermenters and brite tanks with their sizes (or start with Brew Manager&apos;s 11), and this page shows what is in each one and what needs doing.
        </EmptyState>
      </>
    );
  }

  // Where each item is done: the tank's card, or the schedule for a clash.
  const tankOfBatch = new Map<string, string>();
  for (const t of f.tanks) {
    if (t.now) tankOfBatch.set(t.now.batchId, t.tank.id);
    if (t.next && !tankOfBatch.has(t.next.batchId)) tankOfBatch.set(t.next.batchId, t.tank.id);
  }
  const hrefOf = (i: (typeof f.todos)[number]) => {
    if (i.kind === "clash") return "/brewery/schedule";
    const tankId = i.tankId ?? (i.batchId ? tankOfBatch.get(i.batchId) : undefined);
    return tankId ? `#tank-${tankId}` : i.batchId ? `/brewery/batches/${i.batchId}` : "/brewery/schedule";
  };
  const s = f.stats;

  return (
    <>
      {header}
      <TanksDownNote />
      <Section title="Needs doing" description={f.todos.length ? undefined : "Nothing due today or tomorrow."}>
        {f.todos.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {f.todos.map((i) => (
              <li key={i.key}>
                <Link href={hrefOf(i)} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors duration-120 hover:bg-surface-2/60 active:bg-surface-2">
                  <Dot tone={i.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm font-medium text-pretty sm:line-clamp-1">{i.title}</span>
                    <span className="block truncate text-xs text-muted">{i.detail}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="px-4 py-3.5 text-sm text-muted">Transfers, packaging, brew days and tank clashes show here as they come up.</Card>
        )}
      </Section>

      <p className="num -mt-4 mb-6 text-sm text-muted">
        {[s.fermenting ? `${s.fermenting} fermenting` : null, s.conditioning ? `${s.conditioning} conditioning` : null, s.bblInTanks ? `${Number(s.bblInTanks.toFixed(1))} bbl in tanks` : null, `${plural(s.plannedNext14, "brew")} planned in the next two weeks`].filter(Boolean).join(" · ")}
      </p>

      <TanksView f={f} />
    </>
  );
}
