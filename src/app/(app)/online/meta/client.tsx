"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { Select } from "@/components/select";
import { useConfirm } from "@/components/dialog";
import { openFeedback } from "@/components/feedback";
import { chooseMetaPage, disconnectMetaAction, findMetaPages, removeMetaKey, saveMetaKey, syncMetaNow } from "./actions";

export function MetaKeyField({ name, label, placeholder, set, hint, sensitive }: { name: "META_APP_ID" | "META_APP_SECRET"; label: string; placeholder: string; set: boolean; hint: string | null; sensitive?: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(set ? hint ?? "saved" : null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveMetaKey(name, value);
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
                await removeMetaKey(name);
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

interface PageOption {
  id: string;
  name: string;
  instagram: string | null;
  canAnalyze: boolean;
}

/** Which Facebook Page is the business (its Instagram account comes with it). */
export function MetaPages({ pageId, pageName, igUsername }: { pageId: string | null; pageName: string | null; igUsername: string | null }) {
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  const apply = (r: { error?: string; pages?: PageOption[]; notes?: string[] }) => {
    if (r.error) return setError(r.error);
    setError(null);
    setPages(r.pages ?? []);
    setNotes(r.notes ?? []);
    router.refresh();
  };
  const choose = async (id: string) => {
    if (!id || id === pageId) return;
    const to = pages?.find((p) => p.id === id);
    // Ask first, outside the transition: another Page is another business's numbers.
    if (pageId && !(await confirm({ title: `Switch to ${to?.name ?? "this Page"}?`, body: "The numbers and posts already brought in for the current Page and its Instagram account are cleared, then read again for the new one.", confirmLabel: "Switch", danger: true }))) return;
    start(async () => apply(await chooseMetaPage(id)));
  };
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <div className="font-semibold">Which Page and Instagram account</div>
          <p className="text-muted">Found from the Facebook sign-in. The Instagram account is the one linked to the Page.</p>
        </div>
        <Button onClick={() => start(async () => apply(await findMetaPages()))} disabled={pending}>{pending ? "Looking…" : "Find again"}</Button>
      </div>
      {pages && pages.length > 0 && (
        <label className="block max-w-lg">
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Facebook Page</span>
          <Select value={pageId ?? ""} onChange={(e) => choose(e.target.value)} options={[...(pageId ? [] : [{ value: "", label: "Pick a Page" }]), ...pages.map((p) => ({ value: p.id, label: p.name, hint: p.instagram ? `Instagram: @${p.instagram}` : "No Instagram account linked" }))]} />
        </label>
      )}
      {!pages && pageName && (
        <p className="text-sm text-ink-2">
          Using the Page <b className="font-semibold">{pageName}</b>
          {igUsername ? <> and the Instagram account <b className="font-semibold">@{igUsername}</b>.</> : <>. No Instagram account is linked to it yet (see Before you start).</>}
        </p>
      )}
      {notes.map((n) => <p key={n} className="text-sm text-pretty text-warn">{n}</p>)}
      {error && <p className="text-sm text-pretty text-bad">{error}</p>}
    </Card>
  );
}

/** Opens the app's Feedback sheet, which notes this page by itself. */
export function MetaFeedbackButton() {
  return (
    <Button variant="ghost" size="sm" className="h-10 shrink-0 sm:h-9" onClick={() => openFeedback()}>
      Feedback
    </Button>
  );
}

export function MetaManage() {
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
            const r = await syncMetaNow();
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
          const ok = await confirm({ title: "Disconnect Instagram and Facebook?", body: "The app stops reading both, and Facebook forgets its permission. Numbers and posts already brought in stay.", confirmLabel: "Disconnect", danger: true });
          if (!ok) return;
          start(async () => {
            await disconnectMetaAction();
            setMsg(null);
            router.refresh();
          });
        }}
      >
        Disconnect
      </Button>
      {msg && <span className={msg.ok ? "min-w-0 text-sm text-pretty text-good" : "min-w-0 text-sm text-pretty text-bad"}>{msg.text}</span>}
    </div>
  );
}
