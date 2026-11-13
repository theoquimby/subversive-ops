"use client";

import { FileDrop, type FileDropHandle } from "@/components/file-drop";
import { Switch } from "@/components/push-toggle";
import { Button, DatePicker, Field, Input } from "@/components/ui";
import { expiryFor } from "@/domain/certs";
import { Camera, Loader2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { prepareUpload } from "../../invoices/compress";
import { fullDateOf, validityText } from "./status";

type Result = { error?: string; ok?: string };

/**
 * Add or renew a certificate: photo / PDF (photos are shrunk in the browser
 * first), issue date, optional number, and the expiry worked out from the
 * type's validity unless changed. Used by managers (sheet) and staff (/my).
 */
export function CertForm({ fields, validityMonths, today, onSubmit, verifyToggle, submitLabel = "Save certificate", requireFile = false, onDone }: {
  fields: Record<string, string>;
  validityMonths: number | null;
  today: string;
  onSubmit: (fd: FormData) => Promise<Result>;
  /** Managers: "I've seen the original" (on by default). */
  verifyToggle?: boolean;
  submitLabel?: string;
  requireFile?: boolean;
  onDone?: (msg: string) => void;
}) {
  const drop = useRef<FileDropHandle>(null);
  const [file, setFile] = useState<File | null>(null);
  const [issued, setIssued] = useState(today);
  const [custom, setCustom] = useState(false);
  const [expires, setExpires] = useState("");
  const [number, setNumber] = useState("");
  const [verified, setVerified] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const auto = issued ? expiryFor(issued, validityMonths) : null;

  const submit = () =>
    start(async () => {
      setError(null);
      if (requireFile && !file) return setError("Add a photo or PDF of the certificate.");
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      fd.set("issuedOn", issued);
      if (custom && expires) fd.set("expiresOn", expires);
      if (number.trim()) fd.set("number", number.trim());
      if (verifyToggle) fd.set("verified", verified ? "yes" : "no");
      if (file) {
        const ready = await prepareUpload(file);
        if ("error" in ready) return setError(ready.error);
        fd.set("file", ready);
      }
      const r = await onSubmit(fd);
      if (r.error) return setError(r.error);
      drop.current?.clear();
      setFile(null);
      setNumber("");
      setCustom(false);
      setExpires("");
      onDone?.(r.ok ?? "Saved");
    });

  return (
    <div className="space-y-3">
      <FileDrop ref={drop} accept="image/*,application/pdf" hint="Photo or PDF of the card · up to 8 MB" onFile={setFile} />
      {/* Phones: straight to the camera. */}
      <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink active:bg-surface-2 sm:hidden">
        <Camera className="size-4" />Take a photo
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f) setFile(f); e.target.value = ""; }} />
      </label>
      {file && <p className="text-xs text-muted sm:hidden">Attached: {file.name}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Issued">
          <DatePicker value={issued} onChange={(e) => setIssued(e.target.value)} max={today} today={today} aria-label="Date issued" />
        </Field>
        <Field label="Number (optional)">
          <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 2026-4481" maxLength={80} />
        </Field>
      </div>
      {custom ? (
        <Field label="Expires" hint={auto ? `Usually ${fullDateOf(auto)} (${validityText(validityMonths)})` : undefined}>
          <DatePicker value={expires} onChange={(e) => setExpires(e.target.value)} min={issued} today={today} aria-label="Expiry date" />
        </Field>
      ) : (
        <p className="text-sm text-muted">
          {auto ? <>Expires <span className="font-medium text-ink-2">{fullDateOf(auto)}</span> ({validityText(validityMonths)}).</> : "This one doesn't expire."}{" "}
          <button type="button" onClick={() => { setCustom(true); setExpires(auto ?? ""); }} className="inline-flex min-h-10 items-center text-ink-2 underline decoration-border-strong underline-offset-2 hover:text-ink sm:min-h-0">Different date on the card?</button>
        </p>
      )}
      {verifyToggle && (
        <label className="flex items-center gap-2 text-sm">
          <Switch on={verified} onChange={setVerified} label="I've seen the original" />
          I&apos;ve seen the original (mark verified)
        </label>
      )}
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <Button variant="primary" onClick={submit} disabled={pending || !issued} className="h-11 w-full sm:h-9 sm:w-auto">
        {pending ? <><Loader2 className="size-4 animate-spin" />Saving…</> : submitLabel}
      </Button>
    </div>
  );
}
