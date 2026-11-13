"use client";

import { EventSwitches } from "@/components/push-toggle";
import { Button, Input } from "@/components/ui";
import { useState, useTransition } from "react";
import { setNotifyEmail, type PushConfig } from "./actions";

export function EventPrefs({ initial }: { initial: PushConfig }) {
  const [config, setConfig] = useState(initial);
  return <EventSwitches config={config} setConfig={setConfig} />;
}

export function EmailField({ initial, fallback }: { initial: string | null; fallback: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [msg, setMsg] = useState<{ tone: "bad" | "muted"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    if (value.trim() === saved.trim()) return;
    start(async () => {
      const r = await setNotifyEmail(value);
      if (r.error) return setMsg({ tone: "bad", text: r.error });
      setSaved(value.trim());
      setMsg({ tone: "muted", text: r.email ? `Saved. Emails go to ${r.email}.` : "Saved. You won't get emails until there's an address." });
    });
  };
  return (
    <div>
      <div className="flex max-w-md gap-2">
        <Input type="email" inputMode="email" autoComplete="email" placeholder={fallback ?? "you@example.com"} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="Email for notifications" />
        <Button onClick={save} disabled={pending || value.trim() === saved.trim()}>Save</Button>
      </div>
      <p className={msg?.tone === "bad" ? "mt-1.5 text-sm text-bad" : "mt-1.5 text-xs text-muted"}>
        {msg?.text ?? (fallback && !initial ? `Using ${fallback} from your team profile. Type another address to override it.` : "Used for notifications and as the reply-to address on orders you send.")}
      </p>
    </div>
  );
}
