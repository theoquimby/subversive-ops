"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { Select } from "@/components/select";
import { useConfirm } from "@/components/dialog";
import { chooseTargets, disconnectGoogleAction, findGoogleTargets, removeGoogleKey, saveGoogleKey, syncGoogleNow } from "@/app/(app)/website/analytics/actions";

export function CopyChip({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        className="size-10 shrink-0 p-0 sm:size-8"
        aria-label="Copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {done ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
      </Button>
    </span>
  );
}

export function GoogleKeyField({ name, label, placeholder, set, hint, sensitive }: { name: "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET"; label: string; placeholder: string; set: boolean; hint: string | null; sensitive?: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(set ? hint : null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveGoogleKey(name, value);
      if (r.error) setError(r.error);
      else {
        setSaved(r.hint ?? "saved");
        setValue("");
        router.refresh();
      }
    });
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">{label}</div>
      {saved ? (
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <Check className="mr-1 inline size-4 text-good" aria-hidden />
            Saved · <span className="font-mono text-xs">{saved}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await removeGoogleKey(name);
                setSaved(null);
                router.refresh();
              })
            }
          >
            Change
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) save();
          }}
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} type={sensitive ? "password" : "text"} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={label} />
          <Button type="submit" variant="primary" disabled={pending || !value.trim()} className="h-10 shrink-0 sm:h-9">Save</Button>
        </form>
      )}
      {error && <p className="mt-1 text-sm text-bad">{error}</p>}
    </div>
  );
}

/**
 * Find again: asks Google which Search Console properties and listings the
 * signed-in account can see. Both pickers share it (one call finds both); each
 * shows only its own notes.
 */
function useGoogleTargets() {
  const [sites, setSites] = useState<{ siteUrl: string }[] | null>(null);
  const [locations, setLocations] = useState<{ name: string; title: string; address: string | null; placeId: string | null }[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const find = () =>
    start(async () => {
      setError(null);
      const r = await findGoogleTargets();
      if (r.error) return setError(r.error);
      setSites(r.sites ?? []);
      setLocations(r.locations ?? []);
      setNotes(r.notes ?? []);
      router.refresh();
    });
  const choose = (p: Parameters<typeof chooseTargets>[0]) =>
    start(async () => {
      const r = await chooseTargets(p);
      if (r.error) setError(r.error);
      router.refresh();
    });
  return { sites, locations, notes, error, pending, find, choose };
}

const isListingNote = (n: string) => /business profile|listing|my ?business|businessprofile/i.test(n);

/** Search Console: which property is the website. */
export function SearchConsolePicker({ siteUrl }: { siteUrl: string | null }) {
  const t = useGoogleTargets();
  const notes = t.notes.filter((n) => !isListingNote(n));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={t.find} disabled={t.pending}>{t.pending ? "Looking…" : "Find again"}</Button>
        {!t.sites && siteUrl && <span className="min-w-0 text-sm break-all text-ink-2">Using {siteUrl}</span>}
      </div>
      {t.sites && t.sites.length > 0 && (
        <label className="block max-w-lg">
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Search Console property</span>
          <Select value={siteUrl ?? ""} onChange={(e) => t.choose({ siteUrl: e.target.value || null })} options={[{ value: "", label: "None" }, ...t.sites.map((s) => ({ value: s.siteUrl, label: s.siteUrl }))]} />
        </label>
      )}
      {notes.map((n) => <p key={n} className="text-sm text-warn">{n}</p>)}
      {t.error && <p className="text-sm text-bad">{t.error}</p>}
    </div>
  );
}

/** Business Profile: which listing is Subversive. A note about Google's approval is said calmly, not as a warning. */
export function ListingPicker({ location, locationTitle, reviewsFollow }: { location: string | null; locationTitle: string | null; reviewsFollow: boolean }) {
  const t = useGoogleTargets();
  const notes = t.notes.filter(isListingNote);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={t.find} disabled={t.pending}>{t.pending ? "Looking…" : "Find again"}</Button>
        {!t.locations && locationTitle && <span className="min-w-0 text-sm text-ink-2">Using {locationTitle}</span>}
      </div>
      {t.locations && t.locations.length > 0 && (
        <label className="block max-w-lg">
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Business Profile listing</span>
          <Select value={location ?? ""} onChange={(e) => { const l = t.locations!.find((x) => x.name === e.target.value); t.choose({ location: l?.name ?? null, locationTitle: l?.title ?? null, locationPlaceId: l?.placeId ?? null }); }} options={[{ value: "", label: "None" }, ...t.locations.map((l) => ({ value: l.name, label: l.title, hint: l.address ?? undefined }))]} />
        </label>
      )}
      {reviewsFollow && <p className="text-sm text-ink-2">Google reviews follow this listing, so they always come from the same business.</p>}
      {notes.map((n) => <p key={n} className={/hasn't approved|quota is 0/i.test(n) ? "text-sm text-muted" : "text-sm text-warn"}>{n}</p>)}
      {t.error && <p className="text-sm text-bad">{t.error}</p>}
    </div>
  );
}

export function GoogleManage() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncGoogleNow();
            setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Synced." });
            router.refresh();
          })
        }
      >
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      <Button
        variant="danger"
        disabled={pending}
        onClick={async () => {
          // Ask first, outside the transition.
          const ok = await confirm({ title: "Disconnect Google?", body: "The app stops reading Search Console and the listing, and Google forgets its permission. Numbers already brought in stay.", confirmLabel: "Disconnect", danger: true });
          if (!ok) return;
          start(async () => {
            await disconnectGoogleAction();
            router.refresh();
          });
        }}
      >
        Disconnect
      </Button>
      {msg && <span className={msg.ok ? "text-sm text-good" : "text-sm text-bad"}>{msg.text}</span>}
    </div>
  );
}
