"use client";

import { Button, Card } from "@/components/ui";
import { HelpTip, HelpZone } from "@/components/help";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addHomeArea } from "./actions";

/** After a count: "Always list Fryer oil in Third bay dry storage?" One tap, never automatic. */
export function HomeAreaSuggest({ found }: { found: { key: string; name: string; area: string }[] }) {
  const router = useRouter();
  const [done, setDone] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const left = found.filter((f) => !done.includes(`${f.key}|${f.area}`));
  if (left.length === 0) return null;
  return (
    <HelpZone id="count.homeAreas" className="mb-6"><section>
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Found somewhere new <HelpTip id="count.homeAreas" /></h2>
      <Card className="divide-y divide-border">
        {left.map((f) => (
          <div key={`${f.key}|${f.area}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0">Always list <b className="font-medium">{f.name}</b> in {f.area}?</span>
            <Button size="sm" className="h-10 shrink-0" disabled={pending} onClick={() => start(async () => { const r = await addHomeArea(f.key, f.area); if (!r.error) { setDone((d) => [...d, `${f.key}|${f.area}`]); router.refresh(); } })}>Yes, list it</Button>
          </div>
        ))}
      </Card>
    </section></HelpZone>
  );
}
