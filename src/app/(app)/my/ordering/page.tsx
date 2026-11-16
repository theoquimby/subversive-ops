import { HelpZone } from "@/components/help";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { dueLabel } from "@/domain/attention";
import { WEEKDAYS, weekday } from "@/domain/dates";
import { orderAlertStates, type SupplierAlertState } from "@/server/services/orderAlerts";
import { localNow } from "@/server/services/planning";
import { requireOrderer } from "@/server/services/supplierPrefs";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Orders" };

/** What a supplier's row says, in plain words. */
function line(s: SupplierAlertState, today: string): { text: string; tone: "bad" | "warn" | "muted" } {
  if (s.missed) return { text: `${s.missed.title}. ${s.missed.detail}.`, tone: "bad" };
  if (!s.next) return { text: "No delivery days set. Ask a manager.", tone: "muted" };
  const due = dueLabel(today, s.next.cutoffDate, s.next.cutoffTime);
  const day = WEEKDAYS[weekday(s.next.deliveryDate)];
  if (s.placed === "sent") return { text: `Sent for ${day}. Nothing to do.`, tone: "muted" };
  if (s.placed === "draft") return { text: `Saved, not sent yet · due ${due}`, tone: "warn" };
  if (s.nag) return { text: `Needs an order · due ${due} for ${day}`, tone: (s.hoursToCutoff ?? 99) <= 6 ? "bad" : "warn" };
  if (s.mode === "low") return { text: s.need?.countNeeded.length ? "Only when stock runs low · count needed to know" : "Only when stock runs low · nothing needed now", tone: "muted" };
  return { text: `Next deadline ${due}`, tone: "muted" };
}

export default async function MyOrderingPage() {
  await requireOrderer();
  const states = await orderAlertStates(new Date());
  const today = localNow().date;
  const rank = (s: SupplierAlertState) => (s.missed ? 0 : s.placed === "draft" ? 1 : s.nag && s.placed === "none" && s.next ? 2 : s.placed === "sent" ? 4 : 3);
  const rows = [...states].sort((a, b) => rank(a) - rank(b) || (a.hoursToCutoff ?? 1e9) - (b.hoursToCutoff ?? 1e9) || a.name.localeCompare(b.name));
  const todo = rows.filter((s) => rank(s) <= 2);
  const rest = rows.filter((s) => rank(s) > 2);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <PageHeader help="ordering.staff" title="Orders" description="Pick a supplier, check the suggested order, then send it the way they take orders. Nothing goes to a supplier until you send it." back={{ href: "/my", label: "Today" }} />
      <HelpZone id="ordering.staff">
        {todo.length === 0 ? (
          <EmptyState title="Nothing to order right now">Every supplier is ordered or doesn&apos;t need anything yet. You can still start one below.</EmptyState>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {todo.map((s) => <Row key={s.supplierId} s={s} today={today} />)}
          </Card>
        )}
        {rest.length > 0 && (
          <>
            <div className="mt-6 mb-1 text-[0.8rem] font-medium text-ink-2">Other suppliers</div>
            <Card className="divide-y divide-border overflow-hidden">
              {rest.map((s) => <Row key={s.supplierId} s={s} today={today} />)}
            </Card>
          </>
        )}
      </HelpZone>
    </div>
  );
}

function Row({ s, today }: { s: SupplierAlertState; today: string }) {
  const l = line(s, today);
  const href = s.placed === "draft" && s.orderId ? `/my/ordering/order/${s.orderId}` : `/my/ordering/${s.supplierId}`;
  return (
    <Link href={href} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/60">
      <span className="min-w-0">
        <span className="block text-base font-medium text-ink">{s.name}</span>
        <span className={l.tone === "bad" ? "block text-sm text-bad" : l.tone === "warn" ? "block text-sm text-warn" : "block text-sm text-muted"}>{l.text}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
