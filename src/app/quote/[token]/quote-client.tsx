"use client";

import { Button, Input } from "@/components/ui";
import { Check, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptQuoteAction } from "./actions";

export function PrintQuote() {
  return (
    <Button variant="ghost" onClick={() => window.print()} className="h-10">
      <Printer className="size-4" /> Print or save as PDF
    </Button>
  );
}

export function AcceptQuote({ token, deposit }: { token: string; deposit: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await acceptQuoteAction(token, name);
      if (r.error) setError(r.error);
      else {
        setDone(true);
        router.refresh();
      }
    });
  if (done) return <p className="flex items-center gap-2 text-good"><Check className="size-4" /> Thank you — we&rsquo;ve got it.</p>;
  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">Happy with it? Type your name and press accept. {deposit ? `We'll be in touch about the ${deposit} deposit to hold the date.` : "We'll be in touch to confirm."}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" aria-label="Your full name" autoComplete="name" onKeyDown={(e) => e.key === "Enter" && submit()} className="h-11 sm:h-10" />
        <Button variant="primary" size="lg" disabled={pending || name.trim().length < 2} onClick={submit} className="h-11 shrink-0 sm:h-10">
          {pending ? "Accepting…" : "Accept quote"}
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
