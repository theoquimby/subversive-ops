"use client";

import { Card, cx } from "@/components/ui";
import { Camera, FileText, FileUp, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface Page { key: number; file: File; original: File }

/**
 * The pages of one invoice: snap them one after another (phone camera) or pick
 * several photos / a PDF at once. Thumbnails in reading order, each removable.
 */
export function PagesPicker({ pages, onAdd, onRemove, busy, max, receipt = false }: { receipt?: boolean; pages: Page[]; onAdd: (files: File[], how: "camera" | "files") => void; onRemove: (key: number) => void; busy: boolean; max: number }) {
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = pages.length >= max;
  const pick = (list: FileList | null, how: "camera" | "files") => {
    const arr = [...(list ?? [])];
    if (arr.length) onAdd(arr, how);
  };
  const tile = "flex min-h-[4.5rem] flex-1 cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left transition-colors border-border-strong hover:border-ink-2/50 hover:bg-surface-2/50 disabled:pointer-events-none disabled:opacity-50";
  return (
    <div className="space-y-3">
      <div
        className={cx("flex flex-col gap-2 sm:flex-row", over && "rounded-xl ring-2 ring-ink")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files, "files"); }}
      >
        <button type="button" disabled={busy || full} onClick={() => camera.current?.click()} className={cx(tile, "sm:hidden")}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><Camera className="size-4" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{pages.length ? "Snap the next page" : "Take a photo"}</span>
            <span className="block text-xs text-muted">{pages.length ? `Page ${pages.length + 1}, same ${receipt ? "receipt" : "invoice"}` : "Several pages? Snap them one after another"}</span>
          </span>
        </button>
        <button type="button" disabled={busy || full} onClick={() => files.current?.click()} className={tile}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><FileUp className="size-4" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{pages.length ? "Add more pages" : "Choose photos or a PDF"}</span>
            <span className="block text-xs text-muted">{full ? `Up to ${max} pages` : "Pick several photos at once, or drop them here"}</span>
          </span>
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => { pick(e.target.files, "camera"); e.target.value = ""; }} />
        <input ref={files} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} onChange={(e) => { pick(e.target.files, "files"); e.target.value = ""; }} />
      </div>
      {pages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Pages">
          {pages.map((p, i) => <Thumb key={p.key} page={p} n={i + 1} onRemove={() => onRemove(p.key)} disabled={busy} />)}
        </div>
      )}
    </div>
  );
}

function Thumb({ page, n, onRemove, disabled }: { page: Page; n: number; onRemove: () => void; disabled: boolean }) {
  const isPdf = page.file.type === "application/pdf";
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (isPdf) return;
    const u = URL.createObjectURL(page.file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [page.file, isPdf]);
  return (
    <Card className="relative h-28 w-20 shrink-0 overflow-hidden sm:h-32 sm:w-24">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Page ${n}`} className="size-full bg-surface-2 object-cover" />
      ) : (
        <div className="grid size-full place-items-center bg-surface-2 p-2 text-center text-[0.7rem] text-ink-2"><FileText className="size-5 text-muted" /><span className="line-clamp-2 break-all">{page.file.name}</span></div>
      )}
      <span className="num absolute bottom-1 left-1 rounded bg-surface/90 px-1.5 text-xs font-medium">{isPdf ? "PDF" : n}</span>
      <button type="button" aria-label={`Remove page ${n}`} disabled={disabled} onClick={onRemove} className="absolute top-0 right-0 grid size-10 place-items-center text-ink sm:size-8">
        <span className="grid size-6 place-items-center rounded-full bg-surface/90 shadow-sm"><X className="size-3.5" /></span>
      </button>
    </Card>
  );
}

export function ReadingOverlay({ pages }: { pages: number }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-surface/70 backdrop-blur-[1px]">
      <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm font-medium shadow"><Loader2 className="size-4 animate-spin" />Reading {pages > 1 ? `${pages} pages` : "it"}…</div>
    </div>
  );
}
