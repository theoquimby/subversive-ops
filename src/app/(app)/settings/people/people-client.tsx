"use client";

import { HelpZone } from "@/components/help";
import { Badge, Button, Input } from "@/components/ui";
import { useConfirm } from "@/components/dialog";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { useState, useTransition } from "react";
import { AutoChoice, AutoInput, AutoSwitch, SaveStatus } from "../controls";
import { renameUser, setUserActive, setUserPin, setUserRole } from "../setting-actions";

export interface LoginRow { id: string; name: string; role: "MANAGER" | "STAFF"; active: boolean; locked: boolean; me: boolean; employee: string | null }

const ROLES = [{ value: "STAFF", label: "Staff", hint: "Shifts, counts, waste" }, { value: "MANAGER", label: "Manager", hint: "Everything" }];

function PinReset({ id, name }: { id: string; name: string }) {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setStatus("saving");
        start(async () => {
          const r = await setUserPin(id, pin);
          if (r.error) { setError(r.error); setStatus("error"); }
          else { setPin(""); setError(null); setStatus("saved"); setTimeout(() => setStatus("idle"), 2000); }
        });
      }}
    >
      <div>
        <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" placeholder="New PIN" aria-label={`New PIN for ${name}`} className="num w-28" />
        <div className="mt-1 min-h-4"><SaveStatus status={status} error={error} /></div>
      </div>
      <Button type="submit" disabled={pin.length < 4 || status === "saving"}>Set PIN</Button>
    </form>
  );
}

export function LoginsList({ rows }: { rows: LoginRow[] }) {
  const confirm = useConfirm();
  return (
    <div className="divide-y divide-border">
      {rows.map((u) => (
        <div key={u.id} className={cn("grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_9rem_12.5rem_9.5rem] sm:items-start sm:px-5", !u.active && "bg-surface-2/40")}>
          <div className="min-w-0">
            <AutoInput value={u.name} ariaLabel="Name" onSave={(v) => renameUser(u.id, v)} className="sm:max-w-56" />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {u.me && <Badge>You</Badge>}
              <span className="text-xs text-muted">{u.employee ? <>Team: <Link href="/team" className="text-ink-2 underline-offset-2 hover:underline">{u.employee}</Link></> : "Not linked to anyone on Team"}</span>
              {!u.active && <Badge tone="neutral">Switched off</Badge>}
              {u.locked && <Badge tone="warn">Locked — set a new PIN</Badge>}
            </div>
          </div>
          <HelpZone id="settings.people.role"><AutoChoice value={u.role} options={ROLES} ariaLabel={`Access for ${u.name}`}
            confirm={async (v) => v !== "MANAGER" || confirm({ title: `Make ${u.name} a manager?`, body: "Managers see costs, pay rates and settings, and can change anything.", confirmLabel: "Make manager" })}
            onSave={(v) => setUserRole(u.id, v)} /></HelpZone>
          <PinReset id={u.id} name={u.name} />
          <div className="sm:pt-0.5">{u.me ? <span className="text-xs text-muted">Can't switch yourself off</span> : <AutoSwitch on={u.active} label={`${u.name} can sign in`} onText="Can sign in" offText="Off" onSave={(on) => setUserActive(u.id, on)} />}</div>
        </div>
      ))}
    </div>
  );
}
