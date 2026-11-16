"use client";

import { Button, Card } from "@/components/ui";
import { useState, useTransition } from "react";
import { hideCadenceNotice } from "./actions";

/** Shown once after the switch: which suppliers are now "when stock runs low", and how to change it. */
export function CadenceNotice({ names }: { names: string[] }) {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  if (hidden || names.length === 0) return null;
  const list = names.length > 8 ? `${names.slice(0, 8).join(", ")} and ${names.length - 8} more` : names.join(", ");
  return (
    <Card className="mb-4 p-4 text-sm" role="status">
      <div className="font-medium text-ink">Fewer order reminders</div>
      <p className="mt-1 text-ink-2">
        These suppliers are now ordered <span className="font-medium">when stock runs low</span>: {list}. Ops only reminds you about them when counts and sales say something runs short before the delivery after next. They sit under &quot;Nothing needed&quot; below until then.
      </p>
      <p className="mt-1 text-muted">To change one, use its Orders switch (Every delivery / When low) in the table, or open it for reminder settings.</p>
      <div className="mt-3 flex justify-end">
        <Button size="sm" className="h-10 sm:h-8" disabled={pending} onClick={() => { setHidden(true); start(() => hideCadenceNotice()); }}>Got it</Button>
      </div>
    </Card>
  );
}
