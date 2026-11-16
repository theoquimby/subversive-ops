"use client";

import { Button, cx, Input, LinkButton } from "@/components/ui";
import { orderWarnings } from "@/domain/orderGuards";
import { callScript, deliveryDay, devicePlatform, portalCsv, portalText, smsHref, telHref, textOrderMessage, type Platform, type SendLine } from "@/domain/orderSend";
import type { SendBy } from "@/domain/supplierPrefs";
import { Check, Copy, Download, ExternalLink, Mail, MessageSquare, Phone, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

/**
 * The one "send" button for an order, following how the supplier takes orders:
 * Email, Text the order, Copy order for their site, or a call script. Nothing is
 * sent from here without the person pressing send on their own phone or site;
 * then "I sent it" / "I placed it" marks the order sent.
 */

export interface PlaceOrderProps {
  orderId: string;
  supplierName: string;
  deliveryDate: string;
  lines: SendLine[];
  sendBy: SendBy;
  phone: string | null;
  portal: string | null;
  portalUrl: string | null;
  supplierEmail: string | null;
  /** Sign-off ("Subversive"). */
  from: string;
  /** Minutes until this delivery's cutoff (negative once passed). */
  minsToCutoff: number | null;
  /** "I sent it" / "I placed it". */
  onPlaced: (orderId: string, via: SendBy) => Promise<{ ok?: true; error?: string }>;
  /** Email for this order: managers get the full send sheet; omit to use `onEmail`. */
  emailButton?: ReactNode;
  onEmail?: (orderId: string) => Promise<{ ok?: true; error?: string }>;
  /** After it's placed: where "Done" goes (staff); managers just see the page refresh. */
  doneHref?: string;
  className?: string;
}

const LABEL: Record<SendBy, string> = { email: "Email the order", text: "Text the order", portal: "Copy order for their site", phone: "Call the order in" };

export function PlaceOrder(p: PlaceOrderProps) {
  const [open, setOpen] = useState(false);
  if (p.sendBy === "email" && p.emailButton) return <>{p.emailButton}</>;
  const label = p.sendBy === "portal" ? `Copy order for ${p.portal ?? `${p.supplierName}'s site`}` : LABEL[p.sendBy];
  const Icon = p.sendBy === "text" ? MessageSquare : p.sendBy === "phone" ? Phone : p.sendBy === "email" ? Mail : Copy;
  return (
    <>
      <Button variant="primary" className={cx("h-11 sm:h-9", p.className)} onClick={() => setOpen(true)}><Icon className="size-4" />{label}</Button>
      {open && <PlaceSheet {...p} onClose={() => setOpen(false)} />}
    </>
  );
}

function usePlatform(): Platform {
  const [p, setP] = useState<Platform>("desktop");
  useEffect(() => setP(devicePlatform(navigator.userAgent, navigator.maxTouchPoints)), []);
  return p;
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" className="h-10 sm:h-8" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}{done ? "Copied" : label}
    </Button>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PlaceSheet(p: PlaceOrderProps & { onClose: () => void }) {
  const router = useRouter();
  const platform = usePlatform();
  const [phone, setPhone] = useState(p.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const warnings = orderWarnings({ lines: p.lines.map((l) => ({ name: l.name, qty: l.qty, usual: null, unit: l.unit })), minsToCutoff: p.minsToCutoff });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const placed = () =>
    start(async () => {
      setError(null);
      const r = await p.onPlaced(p.orderId, p.sendBy);
      if (r.error) setError(r.error);
      else {
        setDone(true);
        router.refresh();
      }
    });
  const emailIt = () =>
    start(async () => {
      setError(null);
      const r = p.onEmail ? await p.onEmail(p.orderId) : { error: "Email isn't available here." };
      if (r.error) setError(r.error);
      else {
        setDone(true);
        router.refresh();
      }
    });

  const day = deliveryDay(p.deliveryDate);
  const confirmLabel = p.sendBy === "text" ? "I sent it" : "I placed it";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center" onMouseDown={p.onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Send the ${p.supplierName} order`} onMouseDown={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        {done ? (
          <div className="py-2">
            <div className="flex items-center gap-2 text-base font-semibold text-good"><Check className="size-5" />{p.sendBy === "email" ? "Emailed" : "Marked as sent"}</div>
            <p className="mt-1 text-sm text-muted">The {p.supplierName} order for {day} counts as on its way. Check it in when the truck comes.</p>
            <div className="mt-5 flex justify-end gap-2">
              {p.doneHref ? <LinkButton variant="primary" href={p.doneHref} className="h-11 sm:h-9">Done</LinkButton> : <Button variant="primary" className="h-11 sm:h-9" onClick={p.onClose}>Done</Button>}
            </div>
          </div>
        ) : (
          <>
            <div className="text-base font-semibold">{p.sendBy === "portal" ? `Copy order for ${p.portal ?? `${p.supplierName}'s site`}` : `${LABEL[p.sendBy]} · ${p.supplierName}`}</div>
            <p className="mt-0.5 text-sm text-muted">{p.lines.length} line{p.lines.length === 1 ? "" : "s"} for {day}.</p>
            {warnings.map((w) => <p key={w.kind} role="alert" className="mt-3 rounded-lg bg-warn-bg p-3 text-sm text-warn">{w.text}</p>)}

            {p.sendBy === "text" && <TextBody {...p} phone={phone} setPhone={setPhone} platform={platform} />}
            {p.sendBy === "portal" && <PortalBody {...p} />}
            {p.sendBy === "phone" && <CallBody {...p} phone={phone} setPhone={setPhone} />}
            {p.sendBy === "email" && (
              <p className="mt-4 text-sm text-ink-2">{p.supplierEmail ? <>Emails the order to <span className="font-medium">{p.supplierEmail}</span> with a spreadsheet attached, and marks it sent.</> : <>{p.supplierName} has no order email yet. Ask a manager to add it, or call the order in.</>}</p>
            )}

            {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" className="h-11 sm:h-9" onClick={p.onClose}>Not yet</Button>
              {p.sendBy === "email" ? (
                <Button variant="primary" className="h-11 sm:h-9" disabled={pending || !p.supplierEmail} onClick={emailIt}><Send className="size-4" />{pending ? "Sending…" : "Email it"}</Button>
              ) : (
                <Button variant="primary" className="h-11 sm:h-9" disabled={pending} onClick={placed}><Check className="size-4" />{pending ? "Saving…" : confirmLabel}</Button>
              )}
            </div>
            {p.sendBy !== "email" && <p className="mt-2 text-right text-xs text-muted">Press {confirmLabel} only once the supplier has it.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function PhoneField({ phone, setPhone, label }: { phone: string; setPhone: (v: string) => void; label: string }) {
  return (
    <label className="mt-4 block">
      <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">{label}</span>
      <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(518) 555-0142" aria-label={label} />
    </label>
  );
}

function TextBody(p: PlaceOrderProps & { phone: string; setPhone: (v: string) => void; platform: Platform }) {
  const message = textOrderMessage({ supplierName: p.supplierName, deliveryDate: p.deliveryDate, lines: p.lines, from: p.from });
  const phoneOk = p.phone.replace(/\D/g, "").length >= 7;
  return (
    <>
      <PhoneField phone={p.phone} setPhone={p.setPhone} label="Their number" />
      <pre className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-sans text-sm whitespace-pre-wrap text-ink">{message}</pre>
      {p.platform === "desktop" ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted">On a computer: copy this and text it from your phone{phoneOk ? <> to <span className="num font-medium text-ink">{p.phone}</span></> : ""}.</p>
          <div className="flex flex-wrap gap-2"><CopyBtn text={message} label="Copy message" />{phoneOk && <CopyBtn text={p.phone} label="Copy number" />}</div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {phoneOk ? (
            <a href={smsHref(p.phone, message, p.platform)} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-medium text-primary-ink"><MessageSquare className="size-5" />Open Messages</a>
          ) : (
            <p className="text-sm text-warn">Add their number to open Messages with the order typed in.</p>
          )}
          <p className="text-xs text-muted">Messages opens with the order typed in. Check it, press send there, then come back.</p>
          <CopyBtn text={message} label="Copy message" />
        </div>
      )}
    </>
  );
}

function PortalBody(p: PlaceOrderProps) {
  const key = `order-ticks:${p.orderId}`;
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setTicked(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* private mode: ticks just aren't remembered */
    }
  }, [key]);
  const toggle = (sku: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      try {
        window.localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  const file = `${p.supplierName}-${p.deliveryDate}.csv`.replace(/[^\w.-]+/g, "-");
  return (
    <>
      <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-2">Ops never logs into {p.portal ?? "their site"} for you. Key these in yourself, tick each line as you go, then press I placed it.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyBtn text={portalText(p.lines)} label="Copy as text" />
        <Button size="sm" className="h-10 sm:h-8" onClick={() => download(file, portalCsv(p.lines))}><Download className="size-4" />Download CSV</Button>
        {p.portalUrl && <a href={p.portalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm text-ink-2 hover:bg-surface-2 sm:h-8"><ExternalLink className="size-4" />Open {p.portal ?? "their site"}</a>}
      </div>
      <div className="mt-4 flex items-baseline justify-between text-[0.8rem] font-medium text-ink-2">
        <span>Enter as you go</span>
        <span className="num text-muted">{ticked.size} of {p.lines.length} entered</span>
      </div>
      <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
        {p.lines.map((l) => {
          const on = ticked.has(l.sku);
          return (
            <li key={l.sku}>
              <button type="button" onClick={() => toggle(l.sku)} aria-pressed={on} className={cx("flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left", on && "bg-surface-2")}>
                <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-md border", on ? "border-ink bg-primary text-primary-ink" : "border-border-strong")}>{on && <Check className="size-4" />}</span>
                <span className={cx("min-w-0 flex-1", on && "text-muted line-through")}>
                  <span className="num block text-base font-semibold">#{l.sku}</span>
                  <span className="block text-sm"><span className="num font-medium">{Number(l.qty.toFixed(2))} {l.unit}</span> · {l.name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CallBody(p: PlaceOrderProps & { phone: string; setPhone: (v: string) => void }) {
  const script = callScript({ supplierName: p.supplierName, deliveryDate: p.deliveryDate, lines: p.lines, from: p.from });
  const phoneOk = p.phone.replace(/\D/g, "").length >= 7;
  return (
    <>
      <PhoneField phone={p.phone} setPhone={p.setPhone} label="Their number" />
      {phoneOk && <a href={telHref(p.phone)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-medium text-primary-ink"><Phone className="size-5" />Call {p.phone}</a>}
      <div className="mt-4 text-[0.8rem] font-medium text-ink-2">What to say</div>
      <ol className="mt-1 space-y-1.5 rounded-lg border border-border bg-surface-2 p-3 text-sm">
        {script.map((s, i) => <li key={i} className={i === 0 || i === script.length - 1 ? "text-muted" : "num"}>{s}</li>)}
      </ol>
    </>
  );
}
