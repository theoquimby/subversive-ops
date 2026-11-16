import { Card, LinkButton, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { orderingView } from "@/server/services/brewOrdering";
import Link from "next/link";
import { OrdersTable } from "./orders-table";
import { SuppliersTable } from "./suppliers-table";

export const metadata = { title: "Brewery ordering" };

const WHY = { unmatched: "isn't matched to an ingredient", unit: "has a unit that doesn't fit its ingredient", kitchen: "is a kitchen ingredient" } as const;

export default async function Page() {
  await requireUser("MANAGER");
  const v = await orderingView();
  const skipped = [...new Map(v.skipped.map((s) => [`${s.line}|${s.why}`, s])).values()];
  return (
    <>
      <PageHeader
        help="brewery.ordering"
        title="What to order when"
        description="For every brew planned in the next 12 weeks: what each brewing supplier needs to send, after what's on the shelf, and the day to order by."
        actions={<LinkButton href="/brewery/stock">Brewing stock</LinkButton>}
      />
      {!v.suppliers.length && (
        <Card className="mb-6 border-warn/30 bg-warn-bg/40 px-4 py-3 text-sm">
          No brewing suppliers yet, so every order is under &ldquo;No supplier set&rdquo; with a two-week lead time. Add them under <a href="#suppliers" className="font-medium underline underline-offset-2">Brewing suppliers</a>.
        </Card>
      )}
      <OrdersTable orders={v.orders} today={v.today} />
      {skipped.length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">{skipped.length} recipe line{skipped.length === 1 ? " isn't" : "s aren't"} counted here</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {skipped.slice(0, 30).map((s) => <li key={`${s.line}|${s.why}`}>{s.line} on {s.brew} {WHY[s.why]}</li>)}
          </ul>
          <p className="mt-2">Match lines on the <Link href="/brewery/recipes" className="underline underline-offset-2">recipe</Link>, or move kitchen ingredients over on <Link href="/brewery/stock" className="underline underline-offset-2">Brewing stock</Link>.</p>
        </details>
      )}
      <div id="suppliers" className="mt-10 scroll-mt-20">
        <Section
          help="brewery.ordering.suppliers"
          title="Brewing suppliers"
          description="Each supplier's lead time and the day it counts back from. These never show in kitchen ordering. Click a cell to change it."
        >
          <SuppliersTable suppliers={v.suppliers} kitchen={v.kitchenSuppliers} />
        </Section>
      </div>
    </>
  );
}
