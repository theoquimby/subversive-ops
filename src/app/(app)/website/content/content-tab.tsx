import { HelpZone } from "@/components/help";
import { Badge, Card, Section, type Tone } from "@/components/ui";
import Link from "next/link";

type Status = "live" | "ready" | "file" | "code";

const STATUS: Record<Status, { label: string; tone: Tone; hint: string }> = {
  live: { label: "Live from Ops", tone: "good", hint: "The website reads it from Ops today." },
  ready: { label: "Ready in Ops", tone: "warn", hint: "Ops serves it; the website still needs to read it (on its checklist)." },
  file: { label: "In the website's files", tone: "neutral", hint: "Changes need the website team. Asked for in the contract so Max can edit it here later." },
  code: { label: "Fixed wording", tone: "neutral", hint: "Buttons and labels set by the site's design spec. Not meant to be edited." },
};

/** What the website shows and where each piece comes from. Read from the website repo's content/ and src/lib (Nov 2026). */
const BLOCKS: { block: string; where: string; status: Status; edit?: { href: string; label: string } }[] = [
  { block: "Events and closures", where: "/events, event pages, the ticker, open-now and hours", status: "live", edit: { href: "/website/events", label: "Events" } },
  { block: "Weekly hours and kitchen close", where: "Hours card, open-now pill, Visit", status: "ready", edit: { href: "/website/hours", label: "Hours" } },
  { block: "Notice line", where: "Top of every page", status: "ready", edit: { href: "/website/hours", label: "Notice" } },
  { block: "Address, phone, email, links", where: "Footer, Visit, order and gift card buttons", status: "ready", edit: { href: "/website/hours", label: "Contact" } },
  { block: "Menu and draft list", where: "/menu (website has a MenuSource seam for it)", status: "ready", edit: { href: "/website/menu", label: "Menu" } },
  { block: "Private event inquiry form", where: "Not on the website yet", status: "ready", edit: { href: "/website/inquiries", label: "Inquiries" } },
  { block: "Good to know: seating, tent, parking, dogs, gift cards", where: "Visit page (site.json → visit)", status: "file" },
  { block: "About: founders and story", where: "About (site.json → about)", status: "file" },
  { block: "Our beer: brewery paragraphs", where: "Our beer (site.json → brewery)", status: "file" },
  { block: "Sourcing line and farm list", where: "Home and Our beer (site.json → sourcingLine, sourcing)", status: "file" },
  { block: "Band booking line", where: "Visit (site.json → bands)", status: "file" },
  { block: "Photos and captions", where: "Throughout (content/photos.ts)", status: "file" },
  { block: "Buttons and labels", where: "Everywhere (content/microcopy.ts)", status: "code" },
];

export function ContentTab() {
  return (
    <HelpZone id="website.content">
      <Section title="Site content" description="Where each part of the website comes from. Anything marked Live or Ready is edited in Ops; the rest is still in the website's own files.">
        <Card className="divide-y divide-border">
          {BLOCKS.map((b) => (
            <div key={b.block} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="text-sm font-medium">{b.block}</div>
                <div className="text-xs text-muted">{b.where}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span title={STATUS[b.status].hint}><Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge></span>
                {b.edit && (
                  <Link href={b.edit.href} className="inline-flex h-10 items-center rounded-lg px-2 text-sm text-ink-2 underline-offset-2 hover:underline sm:h-8">
                    Edit {b.edit.label.toLowerCase()}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </Card>
        <p className="mt-3 text-sm text-muted">
          The website has no place yet to take its story, visit notes or photos from Ops, so they aren&apos;t editable here. They&apos;re listed as requests for the website in the contract (docs/website-integration.md), so nothing on the site is invented here.
        </p>
      </Section>
    </HelpZone>
  );
}
