import { HelpTip } from "@/components/help";
import { EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { publicOrigin } from "@/server/services/public-url";
import { displayToken, tapList } from "@/server/services/taps";
import { Beer, Tv } from "lucide-react";
import { ComingSoonList, TapListView } from "./taps-client";

export const metadata = { title: "Tap list" };

export default async function TapListPage() {
  const me = await requireUser();
  const manager = me.role === "MANAGER";
  const [list, token, origin] = await Promise.all([tapList(), manager ? displayToken() : null, manager ? publicOrigin() : null]);
  const boardUrl = token ? `${origin}/display/taps/${token}` : null;

  return (
    <>
      <PageHeader
        help="taps.list"
        title="Tap list"
        back={{ href: "/kegs", label: "Kegs" }}
        description={manager ? "What's pouring, in the order the TV board and the website show it." : "What's pouring now and about how much is left."}
        actions={manager ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/kegs/beers" size="sm" className="h-10 sm:h-8"><Beer className="size-4" /> Beers</LinkButton>
            {boardUrl && <LinkButton href={boardUrl} target="_blank" rel="noopener" size="sm" className="h-10 sm:h-8"><Tv className="size-4" /> Open TV board</LinkButton>}
          </div>
        ) : undefined}
      />

      <Section title={<span className="inline-flex items-center gap-1">Pouring now <HelpTip id="taps.list" /></span>} description={list.rows.length ? `${list.rows.length} tap${list.rows.length === 1 ? "" : "s"} on${list.free.length ? ` · ${list.free.length} free` : ""}. “Almost gone” under 15% left, “New” for 3 days after a keg goes on.` : undefined}>
        {list.rows.length === 0 ? (
          <EmptyState title="Nothing on tap" action={<LinkButton href="/kegs/scan">Scan a keg onto a line</LinkButton>}>When a keg is scanned onto a line it shows here, on the TV board and on the website.</EmptyState>
        ) : (
          <TapListView rows={list.rows} free={list.free} manager={manager} />
        )}
      </Section>

      <Section help="taps.comingSoon" title={<span className="inline-flex items-center gap-1">Coming soon <HelpTip id="taps.comingSoon" /></span>} description={list.autoComingSoon ? "Beers not on tap with a full keg in cold storage, plus any you pin on the Beers page." : "Only beers you pin on the Beers page."}>
        <ComingSoonList items={list.comingSoon} auto={list.autoComingSoon} manager={manager} />
      </Section>
    </>
  );
}
