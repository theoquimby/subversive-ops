import Link from "next/link";
import { HelpZone } from "@/components/help";
import { Section } from "@/components/ui";
import { insightFeed } from "@/server/services/analytics";
import { CompactHero } from "./deck";
import { toDeck } from "./deck-data";

/**
 * Today's one thing from the Insights Lab, for the Overview (and anywhere
 * else): `<TopInsights />` — one action, compact, with Do it / Later.
 * Renders nothing until the first analytics run exists. Manager-only data.
 */
export async function TopInsights({ limit = 8, title = "Today's one thing" }: { limit?: number; title?: string }) {
  const { items } = await insightFeed({ limit }).catch(() => ({ items: [] }));
  if (!items.length) return null;
  return (
    <HelpZone id="insights.overview">
      <Section
        title={title}
        actions={<Link href="/insights" className="relative text-sm text-muted transition-colors hover:text-ink after:absolute after:-inset-2 after:content-['']">Insights Lab →</Link>}
      >
        <CompactHero actions={items.map((a) => toDeck(a))} />
      </Section>
    </HelpZone>
  );
}
