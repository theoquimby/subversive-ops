"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell } from "@/components/grid";
import { Button, LinkButton } from "@/components/ui";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { newBoardLink, setBoardTitle } from "./actions";

/** Kegs → Setup: the TV board's private link, copy / open / replace, and the board's name. */
export function BoardLink({ url: initial, title, embedUrl }: { url: string; title: string; embedUrl: string }) {
  const confirm = useConfirm();
  const [url, setUrl] = useState(initial);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  };

  const replace = async () => {
    // The dialog is awaited first; only the save runs in the transition.
    const ok = await confirm({ title: "Make a new TV link?", body: "The old link stops working: any TV showing it says the link was replaced within a minute. Open the new one on each TV.", confirmLabel: "New link", danger: true });
    if (!ok) return;
    start(async () => {
      const r = await newBoardLink();
      if ("error" in r) setError(r.error);
      else { setUrl(r.url); setError(null); }
    });
  };

  const embed = `<iframe src="${embedUrl}" title="On tap at Subversive" style="width:100%;height:640px;border:0" loading="lazy"></iframe>`;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-medium">TV link</div>
        <p className="mt-0.5 text-xs text-muted">Open it in the TV's browser (Fire TV Silk, a smart TV, or a Chromecast tab). No sign-in needed — keep it private, anyone with it can see the board.</p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-60 truncate rounded-md bg-surface-2 px-2.5 py-2 text-xs" title={url}>{url}</code>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-10 sm:h-8" onClick={() => copy(url, "tv")}>{copied === "tv" ? <Check className="size-4 text-good" /> : <Copy className="size-4" />} Copy</Button>
            <LinkButton size="sm" className="h-10 sm:h-8" href={url} target="_blank" rel="noopener"><ExternalLink className="size-4" /> Open</LinkButton>
            <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={replace}><RefreshCw className="size-4" /> New link</Button>
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
      <div className="grid grid-cols-1 items-center gap-1 border-b border-border px-4 py-2.5 sm:grid-cols-[14rem_1fr_12rem]">
        <span className="text-sm font-medium">Name on the board</span>
        <span className="text-xs text-muted">Big letters at the top of the TV and the website list.</span>
        <GridCell grid="board" col="title" value={title} ariaLabel="Name on the board" onSave={setBoardTitle} />
      </div>
      <div className="px-4 py-3">
        <div className="text-sm font-medium">On the website</div>
        <p className="mt-0.5 text-xs text-muted">Paste this where the tap list should go. It updates itself every minute. Add <code>?theme=dark</code> (or <code>?prices=0</code> to hide prices) to the address.</p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-60 truncate rounded-md bg-surface-2 px-2.5 py-2 text-xs" title={embed}>{embed}</code>
          <Button size="sm" className="h-10 sm:h-8" onClick={() => copy(embed, "embed")}>{copied === "embed" ? <Check className="size-4 text-good" /> : <Copy className="size-4" />} Copy</Button>
        </div>
      </div>
    </div>
  );
}
