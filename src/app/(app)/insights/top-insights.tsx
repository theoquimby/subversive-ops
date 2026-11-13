import Link from "next/link";
import { HelpZone } from "@/components/help";
import { Section } from "@/components/ui";
import { insightFeed } from "@/server/services/analytics";
import { FeedList } from "./client";
import { toRow } from "./rows";

/**
 * The top findings from the insight feed, for the Overview (and anywhere else):
 * `<TopInsights />` — renders nothing until the first analytics run exists.
 * Manager-only data; mount it on manager pages.
 */
export async function TopInsights({ limit = 3, title = "3 things worth your attention" }: { limit?: number; title?: string }) {
  const { items } = await insightFeed({ limit }).catch(() => ({ items: [] }));
  if (!items.length) return null;
  return (
    <HelpZone id="insights.overview">
      <Section
        title={title}
        description="From Insights — ranked by dollars a month, how sure we are and whether you've seen it before."
        actions={<Link href="/insights" className="relative text-sm text-muted transition-colors hover:text-ink after:absolute after:-inset-2 after:content-['']">All insights →</Link>}
      >
        <FeedList items={items.map(toRow)} numbered compact />
      </Section>
    </HelpZone>
  );
}
