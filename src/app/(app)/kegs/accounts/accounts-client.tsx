"use client";

import { downloadText } from "@/components/data-table";
import { GridCell, GridSelect } from "@/components/grid";
import { Button, Input } from "@/components/ui";
import { Download, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addAccount, setAccountField } from "../actions";
import { ACCOUNT_KINDS } from "./bits";

/** Name a new account and go straight to its page to fill in the rest. */
export function AddAccount() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        start(async () => {
          const r = await addAccount(name).catch(() => ({ error: "Couldn't add it. Check the connection and try again." }));
          if ("error" in r) setError(r.error);
          else router.push(`/kegs/accounts/${r.id}`);
        });
      }}
    >
      <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="e.g. Catskill Tap House" aria-label="New account name" className="max-w-xs" />
      <Button type="submit" className="h-10 sm:h-9" disabled={pending || !name.trim()}><Plus className="size-4" /> {pending ? "Adding…" : "Add account"}</Button>
      {error && <span role="alert" className="text-sm text-bad">{error}</span>}
    </form>
  );
}

export interface AccountFields {
  id: string;
  name: string;
  kind: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

/** An account's details, edited in place. Each field saves as you leave it, the same way as on Setup. */
export function AccountDetails({ account: a }: { account: AccountFields }) {
  const row = (label: string, el: React.ReactNode) => (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 border-b border-border px-4 py-1.5 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <div className="min-w-0">{el}</div>
    </div>
  );
  const text = (field: "name" | "contact" | "phone" | "email" | "address" | "notes", label: string, placeholder?: string) =>
    row(label, <GridCell grid="account" col={field} ariaLabel={label} value={a[field]} placeholder={placeholder} onSave={(v) => setAccountField(a.id, field, v)} />);
  return (
    <div className="rounded-xl border border-border bg-surface">
      {text("name", "Name")}
      {row("Type", <GridSelect ariaLabel="Type" value={a.kind} options={ACCOUNT_KINDS} onSave={(v) => setAccountField(a.id, "kind", v)} />)}
      {text("contact", "Contact", "Who to ask for")}
      {text("phone", "Phone", "—")}
      {text("email", "Email", "—")}
      {text("address", "Address", "—")}
      {text("notes", "Notes", "Delivery days, where the empties are kept…")}
      {row("On the list", <GridSelect ariaLabel="On the list" value={a.active ? "true" : "false"} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No longer an account" }]} onSave={(v) => setAccountField(a.id, "active", v)} />)}
    </div>
  );
}

const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** A table as a CSV file, named for the report and its dates. */
export function ExportCsv({ filename, header, rows }: { filename: string; header: string[]; rows: (string | number)[][] }) {
  return (
    <Button size="sm" className="h-10 sm:h-8" onClick={() => downloadText(filename, [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"))}>
      <Download className="size-4" /> Export
    </Button>
  );
}
