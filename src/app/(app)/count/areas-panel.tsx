"use client";

import { Button } from "@/components/ui";
import { Settings2, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AreaManager, type AreaRow } from "./area-manager";

/** "Areas" button on the Count page: opens the area manager in a sheet. */
export function AreasPanel({ areas }: { areas: AreaRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Settings2 className="size-4" /> Add or edit areas
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Storage areas">
            <div className="max-h-[85dvh] w-full max-w-lg animate-rise-in overflow-y-auto rounded-t-2xl bg-bg p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">Storage areas</h2>
                  <p className="text-sm text-muted">Where things live. Each area gets its own count.</p>
                </div>
                <Button variant="ghost" size="sm" className="size-10 p-0" onClick={() => setOpen(false)} aria-label="Close"><X className="size-4" /></Button>
              </div>
              <AreaManager areas={areas} compact />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
