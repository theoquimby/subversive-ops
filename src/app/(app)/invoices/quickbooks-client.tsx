"use client";

import { Badge, Button, Card, cx, LinkButton } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { BillState } from "@/server/services/quickbooks";
import { sendInvoiceToQuickBooksAction, sendWaitingToQuickBooks } from "../settings/quickbooks/actions";

export type QboBillState = BillState;

export function QboBadge({ state }: { state: QboBillState | null }) {
  if (!state || state.state === "not-sent") return null;
  if (state.state === "error") return <Badge tone="bad">QuickBooks: not sent</Badge>;
  if (state.state === "sending") return <Badge>Sending to QuickBooks</Badge>;
  return <Badge tone="good">In QuickBooks</Badge>;
}

/** The QuickBooks card on an invoice: where it stands, and Send / Send again. */
export function InvoiceQuickBooks({ invoiceId, state, approved, ready, autoSend }: { invoiceId: string; state: QboBillState; approved: boolean; ready: boolean; autoSend: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const send = () =>
    start(async () => {
      const r = await sendInvoiceToQuickBooksAction(invoiceId);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Sent." });
      router.refresh();
    });

  let line: ReactNode;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (!approved) line = autoSend ? "Goes to QuickBooks as a bill by itself once it's approved." : "Once it's approved, it can go to QuickBooks as a bill.";
  else if (state.state === "sent") {
    tone = "good";
    line = <>In QuickBooks as a bill{state.at && <> · sent {relativeTime(new Date(state.at))}</>}{state.by && state.by !== "auto" && <> by {state.by}</>}{state.attached && " · photo attached"}</>;
  } else if (state.state === "linked") {
    tone = "good";
    line = "This bill was already in QuickBooks (typed in by hand), so it's linked and left as it is.";
  } else if (state.state === "sending") line = "Sending to QuickBooks…";
  else if (state.state === "error") {
    tone = "bad";
    line = <>Not sent: {state.error}</>;
  } else line = "Not in QuickBooks yet.";

  const canSend = approved && ready && state.state !== "linked" && state.state !== "sending";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">QuickBooks</div>
          <p className={cx("mt-0.5 text-sm", tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-muted")}>{line}</p>
        </div>
        {canSend && (
          <Button variant={state.state === "sent" ? "ghost" : "primary"} disabled={pending} onClick={send}>
            {pending ? "Sending…" : state.state === "sent" ? "Send again" : state.state === "error" ? "Try again" : "Send to QuickBooks"}
          </Button>
        )}
        {approved && !ready && <LinkButton href="/settings/quickbooks" size="sm">Choose accounts first</LinkButton>}
      </div>
      {state.state === "sent" && canSend && <p className="mt-1 text-xs text-muted">Sending again updates the same bill if anything changed.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={cx("mt-2 text-sm", msg.ok ? "text-good" : "text-bad")}>{msg.text}</p>}
    </Card>
  );
}

/** "N approved invoices waiting for QuickBooks · Send" on the invoices list. */
export function SendWaiting({ waiting }: { waiting: number }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-3 p-4 text-sm">
      <span className="min-w-0 flex-1">
        {msg ? <span className={msg.ok ? "text-good" : "text-bad"}>{msg.text}</span> : <><b className="num">{waiting}</b> approved invoice{waiting === 1 ? " is" : "s are"} waiting to go to QuickBooks.</>}
      </span>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            let sent = 0;
            let error: string | undefined;
            for (let round = 0; round < 40; round++) {
              const r = await sendWaitingToQuickBooks();
              sent += r.sent;
              error ??= r.error;
              if (!r.remaining || !r.sent) break;
            }
            setMsg(error ? { ok: false, text: `Sent ${sent}. ${error}` } : { ok: true, text: `Sent ${sent} to QuickBooks.` });
            router.refresh();
          })
        }
      >
        {pending ? "Sending…" : `Send ${waiting === 1 ? "it" : `all ${waiting}`}`}
      </Button>
    </Card>
  );
}
