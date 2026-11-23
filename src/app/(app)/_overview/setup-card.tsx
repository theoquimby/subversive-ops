import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";
import { HelpTip, HelpZone } from "@/components/help";
import type { SetupChecklist } from "@/domain/setupChecklist";
import { DismissSetupButton } from "../welcome/dismiss-setup";

/**
 * Overview's "Finish setting up", as one line under Today and Needs you: how
 * many essentials are done and the next one to do, one tap away. The whole
 * list is on /welcome/checklist. Hidden once every essential is done, or when
 * dismissed.
 */
export function SetupCard({ checklist: c }: { checklist: SetupChecklist }) {
  const next = c.items.find((i) => i.group === "essentials" && !i.done) ?? null;
  return (
    <HelpZone id="overview.setup" className="-mt-6 mb-10">
      <Card className="flex items-center gap-1 py-1 pr-1 pl-4">
        <Link href={next?.href ?? "/welcome/checklist"} className="group flex min-h-11 min-w-0 flex-1 items-center gap-3 text-sm">
          <span className="shrink-0 font-medium text-ink">Finish setting up</span>
          <span className="num shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2" aria-label={`${c.essentials.done} of ${c.essentials.total} essentials done`}>
            {c.essentials.done} of {c.essentials.total}
          </span>
          {next && <span className="min-w-0 flex-1 truncate text-ink-2 group-hover:text-ink">Next: {next.title}</span>}
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
        </Link>
        <span className="hidden shrink-0 sm:inline-flex"><HelpTip id="welcome.checklist" /></span>
        <Link href="/welcome/checklist" className="hidden h-10 shrink-0 items-center rounded-md px-2 text-sm text-muted hover:text-ink sm:inline-flex">All steps</Link>
        <DismissSetupButton />
      </Card>
    </HelpZone>
  );
}
