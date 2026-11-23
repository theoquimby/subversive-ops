import { Verdict, type FindingTone } from "@/components/chapter";
import { LinkButton, PageHeader, Section } from "@/components/ui";
import { STATUS_LABEL, type StockStatus } from "@/domain/brewStock";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { brewLinkStatus } from "@/server/services/brewIngredientLink";
import { brewStockRows, type BrewStockRow } from "@/server/services/brewStock";
import { LinkIngredients } from "../recipes/link-ingredients";
import { AddIngredient } from "./add-ingredient";
import { StatusStrip } from "./status-strip";
import { StockTable } from "./stock-table";

export const metadata = { title: "Brewing stock" };

const names = (rs: BrewStockRow[], max = 3) => {
  const shown = rs.slice(0, max).map((r) => r.name);
  const more = rs.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
};

/** The finding the page opens with: count first when nothing is known, else what runs short, else all clear. */
function verdictOf(rows: BrewStockRow[]): { tone: FindingTone; title: string; line: string; action: { href: string; label: string } | null } {
  const by = (s: StockStatus) => rows.filter((r) => r.status === s);
  const uncounted = by("uncounted");
  const short = by("short").sort((a, b) => (a.firstShortOn ?? "").localeCompare(b.firstShortOn ?? ""));
  const soon = by("soon").sort((a, b) => (a.firstShortOn ?? "").localeCompare(b.firstShortOn ?? ""));
  const neededUncounted = uncounted.filter((r) => r.brews.length > 0);
  if (uncounted.length === rows.length) {
    return {
      tone: "unknown",
      title: "Count brewing stock first",
      line: `None of the ${rows.length} brewing ingredients has been counted, so Ops can't tell what's on the shelf or what a planned brew will run short of.${neededUncounted.length ? ` Planned brews in the next eight weeks use ${neededUncounted.length} of them.` : ""}`,
      action: { href: "/brewery/stock/count", label: "Count brewing stock" },
    };
  }
  if (short.length) {
    const first = short[0];
    return {
      tone: "bad",
      title: short.length === 1 ? `${first.name} is short${first.brews[0] ? ` for ${first.brews[0]}` : ""}${first.firstShortOn ? ` on ${shortDate(first.firstShortOn)}` : ""}` : `${short.length} brewing ingredients are short for brews in the next three weeks`,
      line: `${short.length > 1 ? `${names(short)}. ` : ""}Order now, or move the brew.${uncounted.length ? ` ${uncounted.length} more ${uncounted.length === 1 ? "has" : "have"} never been counted, so could be short too.` : ""}`,
      action: { href: "/brewery/ordering", label: "Open brewery ordering" },
    };
  }
  if (uncounted.length) {
    return {
      tone: "unknown",
      title: `Count the ${uncounted.length} brewing ingredient${uncounted.length === 1 ? "" : "s"} never counted`,
      line: `${names(uncounted)} ${uncounted.length === 1 ? "has" : "have"} no count, so Ops can't tell whether planned brews are covered.${neededUncounted.length ? ` ${neededUncounted.length} of them ${neededUncounted.length === 1 ? "is" : "are"} on a planned brew.` : ""}${soon.length ? ` ${soon.length} counted ingredient${soon.length === 1 ? "" : "s"} to order soon.` : ""}`,
      action: { href: "/brewery/stock/count", label: "Count brewing stock" },
    };
  }
  if (soon.length) {
    return {
      tone: "warn",
      title: `Order ${soon.length === 1 ? soon[0].name : `${soon.length} brewing ingredients`} soon`,
      line: `${soon.length > 1 ? `${names(soon)}. ` : ""}A planned brew in the next eight weeks would run short${soon[0].firstShortOn ? `, the first on ${shortDate(soon[0].firstShortOn)}` : ""}.`,
      action: { href: "/brewery/ordering", label: "Open brewery ordering" },
    };
  }
  return { tone: "good", title: "Brewing stock covers every planned brew", line: "Nothing runs short for the brews planned in the next eight weeks.", action: null };
}

export default async function Page() {
  await requireUser("MANAGER");
  const [{ today, rows, strays }, link] = await Promise.all([brewStockRows(), brewLinkStatus()]);
  const v = rows.length ? verdictOf(rows) : null;
  const count = (s: StockStatus) => rows.filter((r) => r.status === s).length;
  const counted = rows.length - count("uncounted");
  return (
    <>
      <PageHeader
        help="brewery.stock"
        title="Brewing stock"
        description="Malt, hops, yeast and other brewing ingredients: what's on the shelf, what brews used, and what planned brews need. Kept apart from kitchen counts."
        actions={
          <>
            <LinkButton href="/brewery/stock/received">Received a delivery</LinkButton>
            <LinkButton href="/brewery/stock/count" variant={v?.action?.href === "/brewery/stock/count" ? "secondary" : "primary"}>Count brewing stock</LinkButton>
          </>
        }
      />
      {v && (
        <Verdict
          badge={{ tone: v.tone }}
          title={v.title}
          line={v.line}
          stats={[
            { label: "Never counted", value: `${count("uncounted")} of ${rows.length}`, tone: count("uncounted") ? "unknown" : "neutral" },
            { label: STATUS_LABEL.short, value: counted ? count("short") : "—", hint: counted ? "a brew in the next three weeks" : "Count first to tell", tone: counted ? (count("short") ? "bad" : "neutral") : "unknown" },
            { label: STATUS_LABEL.soon, value: counted ? count("soon") : "—", hint: counted ? "a brew in the next eight weeks" : "Count first to tell", tone: counted ? (count("soon") ? "warn" : "neutral") : "unknown" },
          ]}
        >
          <StatusStrip counts={{ short: count("short"), soon: count("soon"), fine: count("fine"), uncounted: count("uncounted") }} />
          {v.action && (
            <div className="mt-5">
              <LinkButton href={v.action.href} variant="primary">{v.action.label}</LinkButton>
            </div>
          )}
        </Verdict>
      )}
      <LinkIngredients variant="empty" unlinked={link.unlinkedLines} show={rows.length === 0 && link.recipes > 0} />
      <StockTable rows={rows} today={today} />
      <p className="mt-3 text-xs text-muted">On hand is the last count, plus deliveries, less what each brew used (worked out from its recipe when it&apos;s marked brewed), plus fixes. An ingredient never counted shows no amount: what&apos;s on the shelf isn&apos;t known until it is. Tap an ingredient for its history, a delivery or a fix.</p>
      <Section className="mt-10" title="Add a brewing ingredient" description="Brewing ingredients live on the brewery side: they never show in kitchen counts or kitchen ordering.">
        <AddIngredient strays={strays} />
      </Section>
    </>
  );
}
