import { Badge, Card, LinkButton } from "@/components/ui";
import { canSee, getArea, getHelp, helpFor, relatedOf } from "@/help/content";
import { HelpMarkdown } from "@/help/markdown";
import { getTour } from "@/help/tours";
import { requireUser } from "@/server/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowMe } from "../show-me";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: getHelp(id)?.title ?? "Help" };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const entry = getHelp(decodeURIComponent(id));
  if (!entry || !canSee(entry, me.role)) notFound();

  const area = getArea(entry.area);
  const tour = entry.tour ? getTour(entry.tour) : undefined;
  const showTour = tour && (me.role === "MANAGER" || tour.audience === "all");
  const related = relatedOf(entry, me.role);
  const siblings = helpFor(me.role).filter((e) => e.area === entry.area);
  // Only link to the page itself when it isn't a dynamic detail page.
  const openable = entry.route && !entry.draft && (me.role === "MANAGER" || /^\/(count|waste)/.test(entry.route));

  return (
    <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <article className="min-w-0">
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
          <Link href="/help" className="hover:text-ink">Help</Link>
          <span aria-hidden>/</span>
          <Link href={`/help#area-${entry.area}`} className="hover:text-ink">{area?.title}</Link>
        </nav>

        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[1.9rem] leading-tight font-semibold tracking-tight text-balance text-ink">{entry.title}</h1>
            {entry.draft && <Badge>Coming soon</Badge>}
          </div>
          <p className="mt-3 max-w-[38rem] text-[1.075rem] leading-relaxed text-ink-2">{entry.body}</p>
          {(showTour || openable) && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {showTour && <ShowMe tourId={tour.id} label={`Show me · ${tour.title}`} />}
              {openable && <LinkButton href={entry.route!}>Open this page</LinkButton>}
            </div>
          )}
        </header>

        {entry.article && (
          <div className="max-w-[38rem] border-t border-border pt-8">
            <HelpMarkdown source={entry.article} />
          </div>
        )}

        {entry.draft && (
          <p className="mt-8 max-w-[38rem] rounded-lg bg-surface-2/70 px-4 py-3 text-sm text-muted">This page is being built. These notes describe how it's meant to work and will be updated when it ships.</p>
        )}

        {related.length > 0 && (
          <section className="mt-12 max-w-[38rem]">
            <h2 className="mb-3 text-sm font-semibold text-ink">Related</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {related.map((r) => (
                <Link key={r.id} href={`/help/${r.id}`}>
                  <Card className="h-full p-4 transition-colors hover:border-border-strong">
                    <div className="text-sm font-medium">{r.title}</div>
                    <p className="mt-1 line-clamp-2 text-[0.8rem] leading-relaxed text-muted">{r.body}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>

      <aside className="hidden lg:block">
        <div className="sticky top-12">
          <div className="mb-2 text-xs font-medium text-muted">{area?.title}</div>
          <ul className="space-y-0.5 border-l border-border">
            {siblings.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/help/${s.id}`}
                  aria-current={s.id === entry.id ? "page" : undefined}
                  className={s.id === entry.id ? "-ml-px block border-l-2 border-ink py-1 pl-3 text-sm font-medium text-ink" : "-ml-px block border-l-2 border-transparent py-1 pl-3 text-sm text-muted hover:border-border-strong hover:text-ink"}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
