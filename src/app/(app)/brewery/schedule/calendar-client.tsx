"use client";

import { useConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Button, Card, Input } from "@/components/ui";
import { CalendarDays, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { regenerateCalendarAction } from "./actions";

/**
 * "Add to Google Calendar": the feed's address to copy, a link that opens
 * Google Calendar's add-by-URL with it filled in, and a new address when the
 * old one has gone too far.
 */
export function CalendarCard({ url, googleUrl }: { url: string; googleUrl: string }) {
  const [toast, show] = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      show("Calendar address copied");
    } catch {
      show("Couldn't copy. Select the address and copy it.", "bad");
    }
  };
  return (
    <Card className="p-4 sm:p-5">
      {toast}
      <div className="flex items-center gap-2 text-[0.95rem] font-semibold"><CalendarDays className="size-4 text-area" />Add to Google Calendar</div>
      <p className="mt-1 text-sm text-muted">Open Google Calendar and confirm, or paste this address under Other calendars, +, From URL.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input value={url} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Calendar address" className="num min-w-0 flex-1 text-xs" />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={copy}><Copy className="size-4" />Copy</Button>
          <a href={googleUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-ink hover:opacity-90 sm:h-9 sm:flex-none">
            <ExternalLink className="size-4" />Open Google Calendar
          </a>
        </div>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (!(await confirm({ title: "Make a new calendar address?", body: "The old address stops working, so calendars that use it stop updating. Add the new one to them.", confirmLabel: "New address" }))) return;
          start(async () => show((await regenerateCalendarAction()).ok));
        }}
        className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
      >
        <RefreshCw className="size-3.5" />Make a new address
      </button>
    </Card>
  );
}
