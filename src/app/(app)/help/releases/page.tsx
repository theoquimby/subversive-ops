import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { RELEASES } from "@/help/releases";
import { showMeHref, whatsNewFor } from "@/help/whatsNew";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { hasAppRoute } from "@/server/services/whatsNew";
import { OpenWhatsNew } from "./open-whats-new";

export const metadata = { title: "Release notes" };

export default async function ReleaseNotesPage() {
  const me = await requireUser();
  const visible = new Map(whatsNewFor(me.role, hasAppRoute).map((e) => [e.id, e]));
  const releases = RELEASES.map((r) => ({ ...r, cards: r.entries.map((id) => visible.get(id)).filter((e) => e !== undefined) }))
    .filter((r) => r.cards.length || (me.role === "MANAGER" && r.fixed?.length));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        help="help.releases"
        back={{ href: "/help", label: "Help" }}
        title="Release notes"
        description="Every update to Subversive Ops, newest first: what changed, where to find it and what to look for. New ones pop up the first time you open the app after they go live."
        actions={<OpenWhatsNew />}
      />

      <ol className="relative space-y-12 border-l border-border pl-6 sm:pl-8">
        {releases.map((r, i) => (
          <li key={r.version} id={`v${r.version}`} className="relative scroll-mt-24">
            <span aria-hidden className={`absolute top-1.5 -left-[1.82rem] size-2.5 rounded-full ring-4 ring-bg sm:-left-[2.32rem] ${i === 0 ? "bg-ink" : "bg-border-strong"}`} />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-2">v{r.version}</span>
              <time dateTime={r.date} className="text-xs text-muted tabular-nums">{shortDate(r.date)}</time>
              {i === 0 && <span className="text-xs font-medium text-ink-2">Latest</span>}
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-balance">{r.title}</h2>
            <p className="mt-1 text-sm text-muted">{r.summary}</p>

            {r.cards.length > 0 && (
              <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {r.cards.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{e.title}</div>
                      <p className="mt-0.5 text-sm text-muted">{e.line}</p>
                    </div>
                    <Link href={showMeHref(e)} className="mt-0.5 shrink-0 text-sm font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">Show me</Link>
                  </li>
                ))}
              </ul>
            )}

            {me.role === "MANAGER" && r.fixed && r.fixed.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Also improved</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
                  {r.fixed.map((f) => (
                    <li key={f} className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-border-strong" />{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
