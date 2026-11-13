import { Badge, Button, cx, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { relativeTime, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadCostingSnapshot, priceAsOf } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { GridCell, GridSelect } from "@/components/grid";
import { linkProductToIngredient, setProductPrice } from "@/server/actions/inline";
import { linkProduct, savePriceAlertThreshold } from "./actions";
import { spikeThreshold } from "@/server/services/notify";
import { HelpTip, HelpZone } from "@/components/help";

export const metadata = { title: "Prices" };

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ supplier?: string; filter?: string; q?: string }> }) {
  await requireUser("MANAGER");
  const { supplier: supplierId, filter, q = "" } = await searchParams;
  const today = businessToday();
  const [suppliers, products, ingredients, imports, snap, threshold] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.supplierProduct.findMany({
      where: {
        active: true,
        ...(supplierId ? { supplierId } : {}),
        ...(filter === "unlinked" ? { ingredientId: null } : {}),
        ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { sku: { contains: q } }] } : {}),
      },
      include: { supplier: { select: { name: true } }, ingredient: { select: { id: true, name: true } } },
      orderBy: [{ supplier: { name: "asc" } }, { description: "asc" }],
      take: 500,
    }),
    db.ingredient.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.priceImport.findMany({ orderBy: { createdAt: "desc" }, take: 1, include: { supplier: { select: { name: true } } } }),
    loadCostingSnapshot(),
    spikeThreshold(),
  ]);
  const unlinkedCount = await db.supplierProduct.count({ where: { active: true, ingredientId: null } });
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ supplier: supplierId, filter, q, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/prices${p.size ? `?${p}` : ""}`;
  };

  const ingredientCell = (p: (typeof products)[number], phone: boolean) =>
    p.ingredient ? (
      <Link href={`/ingredients/${p.ingredient.id}`} className={phone ? "text-ink-2 underline decoration-border-strong underline-offset-2" : "hover:underline"}>{p.ingredient.name}</Link>
    ) : (
      <div className={phone ? "flex flex-wrap items-center gap-1" : "flex items-center gap-1.5"}>
        <GridSelect
          value=""
          options={[{ value: "", label: "Link to ingredient…" }, ...ingredients.map((i) => ({ value: i.id, label: i.name }))]}
          onSave={linkProductToIngredient.bind(null, p.id)}
          ariaLabel={`Link ${p.description}`}
          className={phone ? "w-full min-w-0 border-border text-warn" : "max-w-48 min-w-0 border-border text-warn"}
        />
        <form action={linkProduct.bind(null, p.id)} className="shrink-0">
          <input type="hidden" name="ingredientId" value="__new" />
          <input type="hidden" name="newBase" value="g" />
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" title="Create a new ingredient from this product">+ New</Button>
        </form>
      </div>
    );

  return (
    <>
      <PageHeader
        title="Prices"
        description={imports[0] ? `Last import: ${imports[0].supplier.name}, ${relativeTime(imports[0].createdAt)}` : "Every price change is kept, so plate costs can be compared over time."}
        actions={
          <>
            <LinkButton href="/prices/update">Update by hand</LinkButton>
            <LinkButton href="/prices/import" variant="primary" data-tour="prices.import-button">Import price sheet</LinkButton>
          </>
        }
      />

      <HelpZone id="prices.filters" tour="prices.filters" className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={qs({ supplier: undefined })} className={cx("relative rounded-full px-3 py-1 text-sm after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']", !supplierId ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>All</Link>
        {suppliers.map((s) => (
          <Link key={s.id} href={qs({ supplier: s.id })} className={cx("relative rounded-full px-3 py-1 text-sm after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']", supplierId === s.id ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>{s.name}</Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <Link href={qs({ filter: filter === "unlinked" ? undefined : "unlinked" })} className={cx("relative rounded-full px-3 py-1 text-sm after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']", filter === "unlinked" ? "bg-warn-bg text-warn" : "text-ink-2 hover:bg-surface-2")}>
          Not linked {unlinkedCount > 0 && <span className="num ml-1">{unlinkedCount}</span>}
        </Link>
        <form className="ml-auto w-full sm:w-56">
          {supplierId && <input type="hidden" name="supplier" value={supplierId} />}
          {filter && <input type="hidden" name="filter" value={filter} />}
          <Input name="q" defaultValue={q} type="search" placeholder="Search item or #" />
        </form>
      </HelpZone>

      {products.length === 0 ? (
        <EmptyState title={filter === "unlinked" ? "Everything is linked" : "No products yet"} action={!filter && <LinkButton href="/prices/import">Import a price sheet</LinkButton>}>
          {filter === "unlinked" ? "Every supplier product is tied to an ingredient." : "Import a distributor sheet or add products by hand."}
        </EmptyState>
      ) : (
        <HelpZone id="prices.list">
        <Table>
          <thead>
            <tr><Th className="pr-2 sm:pr-4">Item</Th><Th className="hidden lg:table-cell">Pack</Th><Th className="hidden sm:table-cell"><span className="inline-flex items-center gap-1">Ingredient <HelpTip id="prices.link" /></span></Th><Th align="right" className="pr-4 pl-2 sm:pl-4"><span className="inline-flex items-center gap-1">Price <HelpTip id="prices.list.price" /></span></Th><Th align="right" className="hidden sm:table-cell">vs 30 days ago</Th></tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const hist = snap.priceHistory.get(p.id);
              const now = priceAsOf(hist, today);
              const then = priceAsOf(hist, addDays(today, -30));
              const change = now != null && then ? (now - then) / then : null;
              const last = hist?.filter((h) => h.date <= today).at(-1);
              return (
                <Tr key={p.id}>
                  <Td className="pr-2 sm:pr-4">
                    <div className="font-medium break-words">{p.description}</div>
                    <div className="text-xs text-muted">{!supplierId && `${p.supplier.name} · `}#{p.sku}<span className="sm:hidden">{p.packText ? ` · ${p.packText}` : ""}</span></div>
                    {/* Phone: the ingredient column is hidden, so show the link (or the link picker) under the item. */}
                    <div className="mt-1.5 text-xs sm:hidden">{ingredientCell(p, true)}</div>
                  </Td>
                  <Td className="hidden text-muted lg:table-cell">{p.packText ?? "—"}</Td>
                  <Td className="hidden sm:table-cell">{ingredientCell(p, false)}</Td>
                  <td className="border-b border-border py-1 pr-4 pl-1 align-middle sm:px-2 [tr:last-child_&]:border-b-0">
                    {/* Unit sits beside the cell (not as a GridCell suffix) so long units never overlap the price. */}
                    <div className="flex items-center justify-end gap-1.5">
                      <GridCell grid="prices" col="price" type="number" prefix="$" decimals={2} value={now} onSave={setProductPrice.bind(null, p.id)} ariaLabel={`${p.description} price per ${p.purchaseUnit}`} className="w-[5.5rem] shrink-0 sm:w-24" />
                      <span className="w-12 shrink-0 truncate text-left text-xs text-muted sm:w-16" title={p.purchaseUnit}>/ {p.purchaseUnit}</span>
                    </div>
                    {(last || (change != null && Math.abs(change) >= 0.0005)) && (
                      <div className="pr-1 text-right text-xs text-muted">
                        {change != null && Math.abs(change) >= 0.0005 && <span className={cx("num sm:hidden", change > 0 ? "text-bad" : "text-good")}>{signedPct(change)} · </span>}
                        {last && <span className="whitespace-nowrap"><span className="hidden sm:inline">since </span>{shortDate(last.date)}</span>}
                      </div>
                    )}
                  </td>
                  <Td align="right" className="hidden sm:table-cell">
                    {change == null || Math.abs(change) < 0.0005 ? <span className="text-muted">—</span> : <Badge tone={change > 0 ? "bad" : "good"}>{signedPct(change)}</Badge>}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        </HelpZone>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Alert managers when a price goes up by</span>
        <GridCell grid="price-alert" col="threshold" type="number" suffix="%" value={Math.round(threshold * 1000) / 10} onSave={savePriceAlertThreshold} ariaLabel="Price alert threshold, percent" className="w-20" />
        <span>or more. <Link href="/settings/notifications" className="underline decoration-border-strong underline-offset-2 hover:text-ink">Choose how you hear about it</Link>.</span>
      </div>
    </>
  );
}
