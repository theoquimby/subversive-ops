"use client";

import { useConfirm } from "@/components/dialog";
import { HelpTip } from "@/components/help";
import { Button, Input, LinkButton } from "@/components/ui";
import type { SecretStatus } from "@/domain/secrets";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { findBusiness, forgetBusiness, pickBusiness, type TestResult } from "../actions";
import { More, Note, Outbound, SecretField, Stepper, type Step } from "../connections-client";
import * as Art from "../illustrations";

/** What the Google reviews guide needs: the Places key's status (never its value), the business picked and the last test. */
export interface ReviewsSetup {
  key: SecretStatus;
  placeId: string | null;
  placeName: string | null;
  businessName: string;
  test: TestResult | null;
}

/** Working: which business reviews come from, a way to pick another, and the key. */
export function ReviewsManage({ r }: { r: ReviewsSetup }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3 text-sm">
        <span className="min-w-0"><span className="text-muted">Business · </span><span className="font-medium">{r.placeName ?? "Picked"}</span></span>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={async () => {
            if (await confirm({ title: "Pick a different business?", body: "New reviews stop coming in until you pick one again. Reviews already brought in stay.", confirmLabel: "Unlink" })) {
              start(async () => { await forgetBusiness(); router.refresh(); });
            }
          }}
        >
          Pick a different one
        </Button>
      </div>
      <SecretField name="GOOGLE_PLACES_API_KEY" status={r.key} label="Google key" placeholder="AIza…" hint="Starts with AIza, 39 characters." />
    </div>
  );
}

/** The step-by-step guide: a Google Cloud project, Places API (New), the key, then find the business. */
export function GoogleGuide({ r }: { r: ReviewsSetup }) {
  const steps: Step[] = [
    {
      id: "google-project",
      title: "Create a project",
      done: r.key.set,
      art: <Art.GoogleProject />,
      body: (
        <>
          <p>Open Google Cloud, sign in with any Google account, and create a project called <i>Subversive Ops</i>.</p>
          <More>Google Cloud is how Google lets apps read your reviews. Use the project picker at the top → <b>New project</b> → <b>Create</b>. The project made for your Google sign-in works too.</More>
          <Outbound href="https://console.cloud.google.com/projectcreate">Open Google Cloud</Outbound>
        </>
      ),
    },
    {
      id: "google-enable",
      title: "Turn on Places",
      done: r.key.set && r.test?.ok,
      art: <Art.GoogleEnable />,
      body: (
        <>
          <p>Search the top bar for <b>Places API (New)</b> (1), open it and press <b>Enable</b> (2).</p>
          <More>Google asks for a card the first time. Reading reviews once a day stays inside Google&apos;s free allowance, so it costs nothing in practice.</More>
          <Outbound href="https://console.cloud.google.com/apis/library/places.googleapis.com">Open Places API (New)</Outbound>
        </>
      ),
    },
    {
      id: "google-key",
      title: "Copy the key here",
      done: r.key.set,
      art: <Art.GoogleKey />,
      body: (
        <>
          <p>Go to <b>Credentials</b> → <b>Create credentials</b> → <b>API key</b>. Copy it and paste it here.</p>
          <SecretField name="GOOGLE_PLACES_API_KEY" status={r.key} label="Google key" placeholder="AIza…" hint="Starts with AIza, 39 characters." />
        </>
      ),
    },
    {
      id: "google-find",
      title: "Find your business",
      done: !!r.placeId,
      body: <FindBusiness r={r} />,
    },
  ];
  // Key saved but no business yet: open on the step that's left.
  return <Stepper steps={steps} startAt={r.key.set && !r.placeId ? "google-find" : undefined} />;
}

function FindBusiness({ r }: { r: ReviewsSetup }) {
  const [q, setQ] = useState(r.businessName);
  const [places, setPlaces] = useState<{ id: string; name: string; address: string; rating: number | null; reviews: number | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ready = r.key.set;

  if (r.placeId && !places) {
    return (
      <>
        <Note tone="good">
          Linked to <b>{r.placeName ?? "your business"}</b>. New Google reviews come in every morning.
        </Note>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/reviews">See reviews</LinkButton>
          <Button variant="ghost" onClick={() => setPlaces([])}>Pick a different business</Button>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { await forgetBusiness(); router.refresh(); })}>Unlink</Button>
        </div>
      </>
    );
  }

  const search = () =>
    start(async () => {
      setError(null);
      const res = await findBusiness(q);
      if (res.error) {
        setError(res.error);
        setPlaces([]);
      } else setPlaces(res.places ?? []);
      router.refresh();
    });

  return (
    <>
      <p>Search for your restaurant the way you would on Google Maps — the name and town. Then tap the right one.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business name and town" className="pl-9" aria-label="Business name and town" disabled={!ready} />
        </div>
        <Button type="submit" variant="primary" disabled={pending || !ready || q.trim().length < 3}>{pending ? "Searching…" : "Find"}</Button>
      </form>
      {!ready && <p className="text-sm text-muted">Paste the Google key in step 3 first.</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {places && places.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {places.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => { const res = await pickBusiness(p); if (res.error) setError(res.error); else { setPlaces(null); router.refresh(); } })}
                className="flex w-full items-center justify-between gap-3 bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-muted">{p.address}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {p.rating != null && <span className="num">★ {p.rating.toFixed(1)}{p.reviews != null && ` · ${p.reviews}`}</span>}
                  <span className="rounded-md border border-border-strong px-2 py-1 font-medium text-ink">This one</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">The search doubles as the connection test: if Google answers, the key works.<HelpTip id="settings.connections.google" className="ml-1 align-middle" /></p>
    </>
  );
}
