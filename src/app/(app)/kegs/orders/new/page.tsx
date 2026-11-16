import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { kegAvailability, orderFormContext } from "@/server/services/kegOrders";
import { businessToday } from "@/server/services/sales";
import { NewOrderForm } from "../order-form";

export const metadata = { title: "New keg order" };

export default async function NewKegOrderPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const [ctx, stock] = await Promise.all([orderFormContext(), kegAvailability()]);
  const accountId = ctx.accounts.some((a) => a.id === sp.account) ? sp.account! : "";
  const back = accountId ? { href: `/kegs/accounts/${accountId}`, label: ctx.accounts.find((a) => a.id === accountId)!.name } : { href: "/kegs/orders", label: "Orders" };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader help="kegs.orders.new" title="New order" back={back} description="Who it's for, when, and how many kegs of each beer and size." />
      {ctx.accounts.length === 0 ? (
        <EmptyState title="Add an account first" action={<LinkButton href="/kegs/accounts" variant="primary">Go to Accounts</LinkButton>}>An order is for one of your accounts: a bar, a restaurant or a shop your kegs go out to.</EmptyState>
      ) : ctx.beers.length === 0 ? (
        <EmptyState title="Add a beer first" action={<LinkButton href="/kegs/beers" variant="primary">Go to Beers</LinkButton>}>An order lists beers from your beer list.</EmptyState>
      ) : (
        <NewOrderForm ctx={ctx} stock={stock.map((s) => ({ beerId: s.beerId, sizeId: s.sizeId, available: s.available }))} accountId={accountId} today={businessToday()} />
      )}
    </div>
  );
}
