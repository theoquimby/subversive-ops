"use client";

import { Switch } from "@/components/push-toggle";
import { Button, Input, LinkButton } from "@/components/ui";
import { Copy, Download, Mail, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { markOrderSent, sendOrderToSupplier } from "./actions";

interface Props {
  id: string;
  supplierName: string;
  supplierEmail: string | null;
  myEmail: string | null;
  emailReady: boolean;
  subject: string;
  text: string;
  mailto: string | null;
  isDraft: boolean;
  items: number;
}

export function SendToSupplier(p: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={p.isDraft ? "primary" : "secondary"} onClick={() => setOpen(true)}>
        <Send className="size-4" />{p.isDraft ? "Send to supplier" : "Send again"}
      </Button>
      {open && <SendSheet {...p} onClose={() => setOpen(false)} />}
    </>
  );
}

function SendSheet({ id, supplierName, supplierEmail, myEmail, emailReady, subject, text, mailto, isDraft, items, onClose }: Props & { onClose: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState(supplierEmail ?? "");
  const [copyMe, setCopyMe] = useState(Boolean(myEmail));
  const [unavailable, setUnavailable] = useState<string | null>(emailReady ? null : "Email isn't set up yet");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = () =>
    start(async () => {
      const r = await sendOrderToSupplier({ id, to, copyMe });
      if (r.ok) {
        onClose();
        router.refresh();
      } else if (r.skipped) setUnavailable(r.skipped);
      else setError(r.error ?? "Didn't send. Try again.");
    });

  const fallbackMailto = mailto ?? (to ? `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : null);
  const canSend = !unavailable;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Send to supplier" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <div className="text-base font-semibold">Send to {supplierName}</div>
        <p className="mt-1 text-sm text-muted">{items} item{items === 1 ? "" : "s"} · the order as a table plus a CSV attachment.{isDraft ? " It's marked as sent once it goes." : ""}</p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">To</span>
          <Input type="email" inputMode="email" autoFocus={!supplierEmail} value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canSend && to && send()} placeholder="orders@supplier.com" aria-label="Supplier email" />
          {!supplierEmail && <span className="mt-1 block text-xs text-muted">No email on file for {supplierName} — we&apos;ll remember this one.</span>}
        </label>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="font-medium">Send me a copy</div>
            <div className="truncate text-xs text-muted">{myEmail ? `cc ${myEmail} · replies come to you` : "Add your email in Settings → Notifications"}</div>
          </div>
          <Switch on={copyMe} onChange={setCopyMe} label="Send me a copy" disabled={!myEmail} />
        </div>

        {unavailable && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-2">{unavailable}, so this can&apos;t send from here. Copy the order or open it in your mail app instead{isDraft ? ", then mark it as sent" : ""}.</p>}
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}

        {!canSend && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${text}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy className="size-4" />{copied ? "Copied" : "Copy as text"}</Button>
            {fallbackMailto && <LinkButton size="sm" href={fallbackMailto}><Mail className="size-4" />Open in mail app</LinkButton>}
            <LinkButton size="sm" href={`/ordering/po/${id}/csv`} prefetch={false}><Download className="size-4" />CSV</LinkButton>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{canSend ? "Cancel" : "Close"}</Button>
          {canSend ? (
            <Button variant="primary" disabled={pending || !to.trim()} onClick={send}><Send className="size-4" />{pending ? "Sending…" : "Send"}</Button>
          ) : (
            isDraft && <Button variant="primary" disabled={pending} onClick={() => start(async () => { await markOrderSent(id); onClose(); router.refresh(); })}>Mark as sent</Button>
          )}
        </div>
      </div>
    </div>
  );
}
