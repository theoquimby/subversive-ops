"use client";

/**
 * The Feedback button and its sheet, on every signed-in page.
 *
 *   <FeedbackButton />          a row in the desktop sidebar (or `compact`: an icon for the phone top bar)
 *   <FeedbackSheet />           once, in the nav: the sheet itself and the offline queue
 *   openFeedback("mine")        open it from anywhere (e.g. the phone's More sheet)
 *
 * "Send" takes a kind, a few words and an optional photo or screenshot (shrunk
 * here to ≤ 1 MB). The page it was sent from, its title, the device and the
 * app version go along by themselves. With no signal it waits on the phone
 * and sends when the connection is back. "Your notes" lists what you've sent,
 * with its status and any reply.
 */

import { Camera, Check, CloudOff, ImageUp, MessageSquarePlus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { myFeedbackNotes, sendFeedback } from "@/server/actions/feedback";
import type { MyFeedback } from "@/server/services/feedback";
import { cleanPageTitle, deviceLabel, FEEDBACK_KINDS, FEEDBACK_PHOTO_MAX, feedbackKindLabel, feedbackStatusLabel, feedbackStatusTone, type FeedbackKind } from "@/domain/feedback";
import { RELEASES } from "@/help/releases";
import { compressImage } from "@/app/(app)/invoices/compress";
import { cn } from "@/lib/cn";
import { businessDateTime } from "@/lib/format";
import { createOfflineQueue, newClientId, type QueueItem } from "@/lib/offline-queue";
import { Badge, Button, Textarea } from "./ui";
import { useToast } from "./toast";

// ---- Store: open or not, and which tab ----------------------------------------------------

type Tab = "send" | "mine";
let state: { open: boolean; tab: Tab } = { open: false, tab: "send" };
const listeners = new Set<() => void>();
const set = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const closed = { open: false, tab: "send" as Tab };

export const openFeedback = (tab: Tab = "send") => set({ open: true, tab });
const useFeedbackState = () => useSyncExternalStore(subscribe, () => state, () => closed);

// ---- Offline queue -------------------------------------------------------------------------

interface FeedbackItem extends QueueItem {
  kind: FeedbackKind;
  body: string;
  path: string;
  pageTitle: string;
  device: string;
  appVersion: string;
  photo: string | null;
  at: string;
}

const queue = createOfflineQueue<FeedbackItem>({ key: "so.feedback.queue.v1", send: (item) => sendFeedback(item) });

const APP_VERSION = RELEASES[0]?.version ?? "";

function thisDevice(): string {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return deviceLabel(navigator.userAgent, { touch: navigator.maxTouchPoints > 1, installed: standalone });
}

/** Shrink a photo or screenshot to a JPEG of at most 1 MB, trying smaller each time. */
async function shrinkPhoto(f: File): Promise<{ dataUrl: string; size: number } | { error: string }> {
  const tries = [{ maxSide: 1600, quality: 0.8 }, { maxSide: 1280, quality: 0.72 }, { maxSide: 960, quality: 0.65 }];
  for (const t of tries) {
    const out = await compressImage(f, t);
    if (!["image/jpeg", "image/png", "image/webp"].includes(out.type)) return { error: "That kind of image can't be read here. Take a photo or use a screenshot." };
    if (out.size <= FEEDBACK_PHOTO_MAX) {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(out);
      });
      return { dataUrl, size: out.size };
    }
    if (out === f) break; // couldn't be redrawn smaller
  }
  return { error: "That photo is too big to send, even shrunk. Try a screenshot of the part that matters." };
}

// ---- The button --------------------------------------------------------------------------

/** Sits beside the help button: a sidebar row on desktop, or an icon in the phone's top bar. */
export function FeedbackButton({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => openFeedback()}
      aria-label="Send feedback"
      aria-haspopup="dialog"
      className={cn(compact ? "grid size-11 place-items-center rounded-full text-ink-2 active:bg-surface-2" : "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-surface-2/70 hover:text-ink", className)}
    >
      <MessageSquarePlus className={compact ? "size-5" : "size-4 opacity-80"} strokeWidth={1.75} />
      {!compact && "Feedback"}
    </button>
  );
}

// ---- The sheet ----------------------------------------------------------------------------

export function FeedbackSheet() {
  const { open, tab } = useFeedbackState();
  const pathname = usePathname();
  const [toast, showToast] = useToast();
  const waiting = queue.useQueue((failed) => showToast(failed[0] ?? "A note couldn't be sent.", "bad"));
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<{ dataUrl: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | "sent" | "queued">(null);
  const [page, setPage] = useState({ path: "", title: "" });
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const waitingBefore = useRef(0);

  // When queued notes go out after the signal comes back, say so once.
  useEffect(() => {
    if (waitingBefore.current > 0 && waiting.length < waitingBefore.current) showToast("Feedback sent.");
    waitingBefore.current = waiting.length;
  }, [waiting.length, showToast]);

  // The page is read when the sheet opens, so it's the page they were looking at.
  useEffect(() => {
    if (!open) return;
    setPage({ path: `${window.location.pathname}${window.location.search}`, title: cleanPageTitle(document.title) });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ open: false });
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, pathname]);

  const close = useCallback(() => {
    set({ open: false });
    // After a send, the next open starts fresh; an unsent draft is kept.
    if (sent) setSent(null);
  }, [sent]);

  const pick = async (f: File | undefined) => {
    if (camera.current) camera.current.value = "";
    if (upload.current) upload.current.value = "";
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      const r = await shrinkPhoto(f);
      if ("error" in r) setError(r.error);
      else setPhoto(r);
    } catch {
      setError("Couldn't read that photo.");
    }
    setBusy(false);
  };

  const send = async () => {
    if (!body.trim()) {
      setError("Write a few words first.");
      return;
    }
    setBusy(true);
    setError(null);
    const item: FeedbackItem = {
      clientId: newClientId(),
      label: "Feedback",
      kind,
      body: body.trim(),
      path: page.path,
      pageTitle: page.title,
      device: thisDevice(),
      appVersion: APP_VERSION,
      photo: photo?.dataUrl ?? null,
      at: new Date().toISOString(),
    };
    const r = await queue.send(item);
    setBusy(false);
    if ("error" in r) {
      setError(r.error); // the words stay in the box
      return;
    }
    // Storage full or blocked: it was never kept, so don't say it was.
    if (r.queued && !queue.read().some((x) => x.clientId === item.clientId)) {
      setError("No signal, and this phone couldn't keep it for later. Try again when you're back online — your words are still here.");
      return;
    }
    setSent(r.queued ? "queued" : "sent");
    setBody("");
    setPhoto(null);
    setKind("idea");
  };

  return (
    <>
      {toast}
      {open &&
        createPortal(
          <div className="dialog-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={close} role="dialog" aria-modal="true" aria-label="Send feedback">
            <div className="dialog-panel dialog-sheet flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <div role="tablist" aria-label="Feedback" className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
                  {(["send", "mine"] as const).map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set({ tab: t })} className={cn("h-9 rounded-md px-3 text-sm transition-colors duration-120", tab === t ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink")}>
                      {t === "send" ? "Send feedback" : "Your feedback"}
                    </button>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="-mr-2 size-10 shrink-0 p-0" onClick={close} aria-label="Close"><X className="size-4" /></Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {tab === "mine" ? (
                  <MyNotes waiting={waiting} />
                ) : sent ? (
                  <div className="py-6 text-center">
                    <span className={cn("mx-auto grid size-12 place-items-center rounded-full", sent === "sent" ? "bg-good-bg text-good" : "bg-warn-bg text-warn")}>
                      {sent === "sent" ? <Check className="size-6" strokeWidth={2.4} /> : <CloudOff className="size-6" />}
                    </span>
                    <p className="mt-3 text-base font-semibold">{sent === "sent" ? "Thanks — sent." : "Saved on this phone."}</p>
                    <p className="mt-1 text-sm text-muted">{sent === "sent" ? "It's in the managers' feedback inbox, with the page you were on." : "No signal right now. It sends by itself when you're back online."}</p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <Button className="h-11 sm:h-9" onClick={() => set({ tab: "mine" })}>See what you&apos;ve sent</Button>
                      <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setSent(null)}>Send another</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div role="radiogroup" aria-label="Kind of feedback" className="flex flex-wrap gap-1.5">
                      {FEEDBACK_KINDS.map((k) => (
                        <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)} className={cn("h-10 rounded-full border px-3.5 text-sm transition-colors duration-120", kind === k.value ? "border-ink bg-ink text-surface" : "border-border text-ink-2 hover:border-border-strong")}>
                          {k.label}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="What's on your mind? The page you're on is attached."
                      aria-label="Your feedback"
                      className="min-h-32 text-base sm:text-sm"
                      maxLength={5000}
                      autoFocus
                    />
                    <div>
                      {photo ? (
                        <div className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.dataUrl} alt="Attached photo" className="size-16 rounded-lg bg-surface-2 object-cover ring-1 ring-border" />
                          <span className="min-w-0 flex-1 text-xs text-muted">Photo attached · {Math.max(1, Math.round(photo.size / 1024))} KB</span>
                          <Button variant="ghost" size="sm" className="h-10" onClick={() => setPhoto(null)} disabled={busy}>Remove</Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="ghost" size="sm" className="h-10" disabled={busy} onClick={() => camera.current?.click()}><Camera className="size-4" /> Take a photo</Button>
                          <Button variant="ghost" size="sm" className="h-10" disabled={busy} onClick={() => upload.current?.click()}><ImageUp className="size-4" /> Add a screenshot</Button>
                        </div>
                      )}
                      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
                      <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp,image/heic" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
                    </div>
                    <p className="truncate text-xs text-muted" title={page.path}>
                      Attached: {page.title || "this page"} <span className="text-muted/80">· {page.path || "/"}</span>
                    </p>
                    {error && <p role="alert" className="text-sm text-bad">{error}</p>}
                    <Button variant="primary" size="lg" className="w-full" onClick={send} disabled={busy || !body.trim()}>
                      {busy ? "Sending…" : "Send"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ---- Your notes ---------------------------------------------------------------------------

function MyNotes({ waiting }: { waiting: FeedbackItem[] }) {
  const [notes, setNotes] = useState<MyFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    myFeedbackNotes()
      .then((r) => {
        if (!live) return;
        if ("error" in r) setError(r.error);
        else setNotes(r.notes);
      })
      .catch(() => live && setError("Couldn't load your notes — check the signal and try again."));
    return () => {
      live = false;
    };
  }, [waiting.length]);

  const empty = notes?.length === 0 && waiting.length === 0;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Everything you&apos;ve sent, and what&apos;s happening with it.</p>
      {waiting.map((w) => (
        <Note key={w.clientId} kind={w.kind} body={w.body} meta={<>{businessDateTime(w.at)} · {w.pageTitle || w.path}</>} status={<Badge tone="warn"><CloudOff className="mr-1 size-3" />Waiting to send</Badge>} />
      ))}
      {notes?.map((n) => (
        <Note
          key={n.id}
          kind={n.kind}
          body={n.body}
          meta={<>{businessDateTime(n.at)}{n.pageTitle || n.path ? ` · ${n.pageTitle || n.path}` : ""}{n.hasPhoto ? " · photo" : ""}</>}
          status={<Badge tone={feedbackStatusTone(n.status)}>{feedbackStatusLabel(n.status)}</Badge>}
          reply={n.note}
        />
      ))}
      {notes == null && !error && <p className="py-4 text-center text-sm text-muted">Loading…</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {empty && <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-muted">Nothing sent yet. Ideas, problems, questions and things you love all help.</p>}
    </div>
  );
}

function Note({ kind, body, meta, status, reply }: { kind: string; body: string; meta: ReactNode; status: ReactNode; reply?: string | null }) {
  return (
    <article className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{feedbackKindLabel(kind)}</span>
        {status}
      </div>
      <p className="mt-1.5 line-clamp-4 text-sm whitespace-pre-line text-ink">{body}</p>
      <p className="mt-1.5 truncate text-xs text-muted">{meta}</p>
      {reply && (
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          <span className="block text-[11px] font-semibold text-muted">Reply</span>
          <span className="whitespace-pre-line">{reply}</span>
        </div>
      )}
    </article>
  );
}
