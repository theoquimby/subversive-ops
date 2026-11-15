import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, LinkButton } from "@/components/ui";
import { HelpTip, HelpZone } from "@/components/help";
import type { SetupChecklist } from "@/domain/setupChecklist";
import { DismissSetupButton } from "../welcome/dismiss-setup";

/**
 * Overview's "Finish setting up": how many essentials are done, then the next
 * few to do, each with a one-tap "Do it". Hidden once every essential is done
 * (nice-to-haves live on /welcome/checklist) or when dismissed.
 */
export function SetupCard({ checklist: c }: { checklist: SetupChecklist }) {
  const essentials = c.items.filter((i) => i.group === "essentials");
  const todo = essentials.map((i, n) => ({ ...i, n: n + 1 })).filter((i) => !i.done).slice(0, 3);
  const left = essentials.length - c.essentials.done;
  return (
    <HelpZone id="overview.setup" className="mb-6">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              Finish setting up <HelpTip id="welcome.checklist" />
            </div>
            <div className="mt-0.5 text-sm text-muted">
              <span className="num">{c.essentials.done} of {c.essentials.total}</span> essentials done{left <= 2 ? ` — ${left === 1 ? "one" : "two"} to go` : ""}.
            </div>
          </div>
          <DismissSetupButton />
        </div>
        {/* One segment per essential: fills in as each is done. */}
        <div className="mt-3 flex gap-1" aria-hidden>
          {essentials.map((i) => (
            <div key={i.id} className={i.done ? "h-1.5 flex-1 rounded-full bg-good" : "h-1.5 flex-1 rounded-full bg-surface-2"} />
          ))}
        </div>
        <ul className="mt-3 divide-y divide-border">
          {todo.map((i, n) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5 first:pt-1.5 last:pb-0">
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-[0.7rem] font-medium text-muted num">{i.n}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{i.title}</div>
                <div className="hidden truncate text-[0.8rem] text-muted sm:block">{i.detail ? `${i.detail} · ` : ""}{i.why}</div>
              </div>
              <LinkButton href={i.href} size="sm" variant={n === 0 ? "primary" : "secondary"} className="h-10 shrink-0 sm:h-8">
                Do it <ArrowRight className="size-3.5" strokeWidth={2} />
              </LinkButton>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
          <span className="text-[0.8rem] text-muted">{c.nice.total > 0 && `Then ${c.nice.total} nice-to-haves, when you're ready.`}</span>
          <Link href="/welcome/checklist" className="inline-flex h-10 items-center text-sm font-medium text-ink underline-offset-2 hover:underline sm:h-8">
            See the whole list →
          </Link>
        </div>
      </Card>
    </HelpZone>
  );
}
