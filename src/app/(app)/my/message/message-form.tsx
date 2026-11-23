"use client";

import { useToast } from "@/components/toast";
import { Button, Card, cx, Textarea } from "@/components/ui";
import { Send } from "lucide-react";
import { useState, useTransition } from "react";
import { sendStaffMessage } from "../workforce-actions";

const KINDS = [
  { value: "QUESTION", label: "Question" },
  { value: "IDEA", label: "Idea" },
  { value: "CONCERN", label: "Concern" },
  { value: "OTHER", label: "Other" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

export function MessageForm() {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const [kind, setKind] = useState<Kind>("QUESTION");
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const canAnon = kind === "IDEA" || kind === "CONCERN";
  return (
    <Card className="p-4">
      {toast}
      <div role="radiogroup" aria-label="Kind of message" className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1">
        {KINDS.map((k) => (
          <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)} className={cx("h-11 rounded-lg px-1 text-sm transition-[background-color,color,box-shadow] duration-120 sm:h-9", kind === k.value ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 active:bg-surface/60")}>
            {k.label}
          </button>
        ))}
      </div>
      <Textarea aria-label="Message" className="mt-3" rows={4} maxLength={1500} placeholder={kind === "IDEA" ? "What would make shifts better?" : kind === "CONCERN" ? "What's worrying you?" : "What do you want to ask?"} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {canAnon ? (
          <button type="button" role="switch" aria-checked={anon} onClick={() => setAnon(!anon)} className="flex min-h-11 items-center gap-2 text-left text-sm">
            <span className={cx("relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors", anon ? "bg-ink" : "bg-border-strong")}>
              <span className={cx("absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all", anon ? "left-[1.125rem]" : "left-0.5")} />
            </span>
            Hide my name from managers
          </button>
        ) : <span />}
        <Button
          variant="primary"
          className="max-sm:h-12"
          disabled={pending || body.trim().length < 3}
          onClick={() =>
            start(async () => {
              const r = await sendStaffMessage({ kind, body, anonymous: canAnon && anon }).catch(() => ({ error: "No signal, so that didn't go through. Try again in a moment." }) as { error?: string; ok?: string });
              if (r.error) show(r.error, "bad");
              else {
                show(r.ok ?? "Sent");
                setBody("");
                setAnon(false);
              }
            })
          }
        >
          <Send className="size-4" aria-hidden /> Send
        </Button>
      </div>
    </Card>
  );
}
