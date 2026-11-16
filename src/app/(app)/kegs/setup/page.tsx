import { HelpTip } from "@/components/help";
import { PageHeader, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { pourOz, splitItemName } from "@/domain/kegPours";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { beerMatchers, kegAreas, kegConfig } from "@/server/services/kegs";
import { businessToday } from "@/server/services/sales";
import { matchSquareItem } from "@/domain/kegPours";
import { needsALook } from "@/server/services/beerLinks";
import { AccountsTable, BeersTable, PoursEditor, SpotsEditor, TapsConfig } from "./setup-client";
import { NeedsALookList } from "./needs-look";
import { publicOrigin } from "@/server/services/public-url";
import { boardConfig, displayToken } from "@/server/services/taps";
import { BoardLink } from "../taps/board-link";
import { CoreHelperSection } from "../core-helper";
import { standingOf } from "@/domain/beerStanding";

export const metadata = { title: "Keg setup" };

export default async function KegSetupPage() {
  await requireUser("MANAGER");
  const since = addDays(businessToday(), -90);
  const [token, origin, board] = await Promise.all([displayToken(), publicOrigin(), boardConfig()]);
  const [beers, kegCounts, recipes, spots, spotCounts, areas, config, accounts, outCounts, matchers, sales, squareItems, needs] = await Promise.all([
    db.beer.findMany({ orderBy: [{ active: "desc" }, { core: "desc" }, { name: "asc" }] }),
    db.keg.groupBy({ by: ["beerId"], _count: { _all: true } }),
    db.recipe.findMany({ where: { kind: "PREP", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.kegSpot.findMany({ orderBy: [{ area: "asc" }, { sort: "asc" }] }),
    db.keg.groupBy({ by: ["spotId"], where: { spotId: { not: null } }, _count: { _all: true } }),
    kegAreas(),
    kegConfig(),
    db.kegAccount.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.keg.groupBy({ by: ["accountId"], where: { status: "OUT" }, _count: { _all: true } }),
    beerMatchers(),
    db.$queryRaw<{ name: string; squareId: string; qty: number }[]>`SELECT name, "squareId", SUM(qty)::float AS qty FROM "DailySale" WHERE date >= ${new Date(`${since}T00:00:00Z`)}::date GROUP BY name, "squareId"`,
    // Square items a beer can be linked to (its pours).
    db.squareMapping.findMany({ where: { squareType: "ITEM_VARIATION", ignored: false }, select: { squareId: true, squareName: true, beerId: true }, orderBy: { squareName: "asc" } }),
    needsALook(),
  ]);
  // Pour sizes in use: every variation of a beer's Square items, plus any saved one.
  const pours = new Map<string, { variation: string; oz: number; saved: boolean; sold: number }>();
  for (const s of sales) {
    const { variation } = splitItemName(s.name);
    if (!matchSquareItem(s.squareId, s.name, matchers)) continue;
    const v = (variation ?? "Regular").trim();
    const k = v.toLowerCase();
    const cur = pours.get(k) ?? { variation: v, oz: pourOz(variation, { overrides: config.pours }), saved: config.pours[k] != null, sold: 0 };
    cur.sold += s.qty;
    pours.set(k, cur);
  }
  for (const [k, oz] of Object.entries(config.pours)) if (!pours.has(k)) pours.set(k, { variation: k, oz, saved: true, sold: 0 });

  const kc = new Map(kegCounts.map((k) => [k.beerId, k._count._all]));
  return (
    <>
      <PageHeader help="kegs.setup" title="Keg setup" back={{ href: "/kegs", label: "Kegs" }} description="Beers and the Square items that pour them, spots in the walk-in, tap lines, pour sizes and accounts." />

      <CoreHelperSection />

      {needs.count > 0 && (
        <>
          <div id="needs-a-look" className="scroll-mt-20" />
          <Section help="kegs.setup.needs" title={<span className="inline-flex items-center gap-1">Needs a look <HelpTip id="kegs.setup.needs" /></span>} description={`${needs.count} thing${needs.count === 1 ? "" : "s"} around your beers that don't link up on their own. Nothing here was changed for you.`}>
            <NeedsALookList data={needs} />
          </Section>
        </>
      )}

      <Section help="kegs.setup.beers" title={<span className="inline-flex items-center gap-1">Beers <HelpTip id="kegs.setup.beers" /></span>} description="Core beers are the ones you never want to run out of; only they get fill suggestions and alerts. Open a beer to link its Square pours. Typed Square names (the part before the pour, like “New York Nectar*”) link the items they name, and match any item that isn't linked.">
        <BeersTable
          beers={beers.map((b) => ({ id: b.id, name: b.name, style: b.style, color: b.color, squareNames: b.squareNames, minFull: b.minFull, house: b.house, standing: standingOf(b), recipeId: b.recipeId, kegs: kc.get(b.id) ?? 0 }))}
          recipes={recipes}
          squareItems={squareItems.map((s) => ({ squareId: s.squareId, name: s.squareName, beerId: s.beerId }))}
        />
      </Section>

      <div id="spots" className="scroll-mt-20" />
      <Section help="kegs.setup.spots" title={<span className="inline-flex items-center gap-1">Spots <HelpTip id="kegs.setup.spots" /></span>} description="Named places inside an area, like “Back left” or “Door, top”. Staff pick one when they move a keg, and can add a note.">
        <SpotsEditor areas={areas} spots={spots.map((s) => ({ id: s.id, area: s.area, name: s.name }))} counts={Object.fromEntries(spotCounts.map((c) => [c.spotId!, c._count._all]))} />
      </Section>

      <Section title="Taps and storage">
        <TapsConfig config={config} areas={areas} />
      </Section>

      <div id="tv" className="scroll-mt-20" />
      <Section help="taps.tv" title={<span className="inline-flex items-center gap-1">Tap list on a TV <HelpTip id="taps.tv" /></span>} description="A full-screen board of what's pouring, prices and what's coming. It updates itself every minute.">
        <BoardLink url={`${origin}/display/taps/${token}`} title={board.title} embedUrl={`${origin}/api/public/taps/embed`} />
      </Section>

      <Section help="kegs.setup.pours" title={<span className="inline-flex items-center gap-1">Pour sizes <HelpTip id="kegs.setup.pours" /></span>} description="Ounces in each pour, used to work out what's left in a keg. Guessed from the name (Full Pour 16, Half Pour 8, Taster 4); a linked pour recipe wins. 0 means it isn't poured from a keg.">
        {pours.size ? <PoursEditor pours={[...pours.values()].sort((a, b) => b.sold - a.sold)} /> : <p className="text-sm text-muted">Pours show up here once a beer is linked to Square items with sales.</p>}
      </Section>

      <Section help="kegs.setup.accounts" title={<span className="inline-flex items-center gap-1">Accounts <HelpTip id="kegs.setup.accounts" /></span>} description="Bars, restaurants and people kegs go out to.">
        <AccountsTable accounts={accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, contact: a.contact, email: a.email, phone: a.phone, address: a.address, active: a.active, out: outCounts.find((o) => o.accountId === a.id)?._count._all ?? 0 }))} />
      </Section>
    </>
  );
}
