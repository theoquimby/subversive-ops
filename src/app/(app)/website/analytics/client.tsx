"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, Plus, RefreshCw, X } from "lucide-react";
import { Button, Card, cx, Input, Section } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { refreshWebNumbers, saveOrigins } from "./actions";
import { LinkChart } from "./charts";

export function RefreshButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-10 sm:h-8"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await refreshWebNumbers();
          router.refresh();
        })
      }
    >
      <RefreshCw className={cx("size-3.5", pending && "animate-spin")} aria-hidden /> {pending ? "Updating" : "Update now"}
    </Button>
  );
}

export function LinkToggle({ days }: { days: { x: string; sales: number | null; directions: number; actions: number; event: boolean }[] }) {
  const [which, setWhich] = useState<"directions" | "actions">("directions");
  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg bg-surface-2 p-1" role="group" aria-label="Compare with">
        {(
          [
            ["directions", "Direction clicks"],
            ["actions", "All actions"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={which === id} onClick={() => setWhich(id)} className={cx("h-10 rounded-md px-3 text-sm font-medium transition-colors sm:h-8", which === id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>
      <LinkChart days={days.map((d) => ({ x: d.x, sales: d.sales, actions: which === "directions" ? d.directions : d.actions, event: d.event }))} what={which === "directions" ? "direction clicks" : "actions"} />
      <p className="mt-2 text-xs text-muted">Lighter sales bars are event days (left out of the comparison).</p>
    </div>
  );
}

const SNIPPET = (ops: string) => `// app/analytics.tsx — see docs/website-analytics.md
const URL = "${ops}/api/public/collect";`;

export function TrackingSetup({ origins, website, lastHit, ops }: { origins: string[]; website: string | null; lastHit: string | null; ops: string }) {
  const extra = origins.filter((o) => {
    if (/localhost|127\.0\.0\.1/.test(o)) return false;
    if (!website) return true;
    const h = (u: string) => new URL(u).hostname.replace(/^www\./, "");
    return h(o) !== h(website) && !/localhost|127\.0\.0\.1/.test(o);
  });
  const [list, setList] = useState(extra);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const save = (next: string[]) =>
    start(async () => {
      setError(null);
      const r = await saveOrigins(next);
      if (r.error) setError(r.error);
      else {
        setList(r.saved ?? next);
        setDraft("");
        router.refresh();
      }
    });

  return (
    <Section title="Tracking setup" description="What the website sends and where. No cookies, no IP addresses kept, no cookie banner needed." help="website.analytics.setup">
      <Card id="tracking" className="scroll-mt-20 space-y-5 p-4 sm:p-5" data-tour="webanalytics.setup">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="text-[0.8rem] font-medium text-ink-2">Website address</div>
            <p className="mt-1 truncate text-sm">{website ?? <span className="text-muted">Not set: add it on the Website overview</span>}</p>
          </div>
          <div className="min-w-0">
            <div className="text-[0.8rem] font-medium text-ink-2">Last visit received</div>
            <p className="mt-1 text-sm">{lastHit ? relativeTime(new Date(lastHit)) : <span className="text-muted">Nothing yet</span>}</p>
          </div>
        </div>
        <div>
          <div className="text-[0.8rem] font-medium text-ink-2">Other addresses the website runs on</div>
          <p className="mt-0.5 text-xs text-muted">Visits are only accepted from the website&apos;s own addresses. Add a preview or old address here (the www and non-www versions are both covered).</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {list.map((o) => (
              <li key={o} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-1 pr-1 pl-2 text-sm">
                <span className="max-w-[15rem] truncate">{o}</span>
                <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={`Remove ${o}`} disabled={pending} onClick={() => save(list.filter((x) => x !== o))}>
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) save([...list, draft.trim()]);
            }}
          >
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://subversive-website.vercel.app" aria-label="Add an address" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <Button type="submit" disabled={pending || !draft.trim()} className="h-10 shrink-0 sm:h-9">
              <Plus className="size-4" aria-hidden /> Add
            </Button>
          </form>
          {error && <p className="mt-1 text-sm text-bad">{error}</p>}
        </div>
        <div>
          <div className="text-[0.8rem] font-medium text-ink-2">For whoever looks after the website</div>
          <p className="mt-0.5 text-xs text-muted">The website sends a tiny message to this address on every page and tap. The full snippet, the list of taps to send and the security header to update are in docs/website-analytics.md.</p>
          <div className="mt-2 flex min-w-0 items-start gap-2 rounded-lg bg-surface-2 p-3">
            <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-pre text-ink-2">{SNIPPET(ops)}</pre>
            <Button
              variant="ghost"
              size="sm"
              className="size-10 shrink-0 p-0 sm:size-8"
              aria-label="Copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${ops}/api/public/collect`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  /* clipboard not allowed */
                }
              }}
            >
              {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </div>
      </Card>
    </Section>
  );
}
