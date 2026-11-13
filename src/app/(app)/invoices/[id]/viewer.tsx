"use client";

import { FileDrop } from "@/components/file-drop";
import { Card, cx } from "@/components/ui";
import { Camera, ExternalLink, ImageOff, Loader2, Maximize, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addInvoicePage, attachFile, removeInvoicePage } from "../actions";
import { PAGE_QUALITY, prepareUpload } from "../compress";

interface View { s: number; x: number; y: number }
const MIN = 1;
const MAX = 8;
const clampS = (s: number) => Math.min(MAX, Math.max(MIN, s));

/**
 * All pages of an invoice: page tabs above the viewer, plus "Add page" so a
 * forgotten back page can be snapped later. With one page it's just the viewer.
 */
export function InvoicePages({ invoiceId, locked, hasImage, type, pages }: { invoiceId: string; locked: boolean; hasImage: boolean; type: string | null; pages: { position: number; type: string }[] }) {
  const router = useRouter();
  const [current, setCurrent] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const all = [{ position: 1, type: type ?? "image/jpeg" }, ...pages];
  const shown = all.find((p) => p.position === current) ?? all[0];
  if (!hasImage) return <InvoiceViewer src={null} type={type} invoiceId={invoiceId} locked={locked} />;
  const add = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setError(null);
    start(async () => {
      let last = current;
      for (const f of list) {
        const ready = await prepareUpload(f, PAGE_QUALITY);
        if ("error" in ready) { setError(ready.error); break; }
        const fd = new FormData();
        fd.set("file", ready);
        const r = await addInvoicePage(invoiceId, fd);
        if (r.error) { setError(r.error); break; }
        if (r.page) last = r.page;
      }
      setCurrent(last);
      router.refresh();
    });
  };
  const remove = () =>
    start(async () => {
      await removeInvoicePage(invoiceId, current);
      setCurrent(1);
      router.refresh();
    });
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Pages">
        {all.length > 1 && all.map((p, i) => (
          <button key={p.position} type="button" role="tab" aria-selected={p.position === shown.position} onClick={() => setCurrent(p.position)} className={cx("num h-10 min-w-10 rounded-lg px-3 text-sm font-medium sm:h-8 sm:min-w-8", p.position === shown.position ? "bg-primary text-primary-ink" : "bg-surface-2 text-ink-2 hover:text-ink")}>
            {all.length > 1 ? i + 1 : "Page 1"}
          </button>
        ))}
        {all.length > 1 && <span className="mr-auto pl-1 text-xs text-muted">{all.length} pages</span>}
        {!locked && (
          <span className="ml-auto flex items-center gap-1">
            {shown.position > 1 && <button type="button" disabled={pending} onClick={remove} className="h-10 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-8">Remove page</button>}
            <button type="button" disabled={pending} onClick={() => input.current?.click()} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2 sm:h-8">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}Add page
            </button>
            <input ref={input} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </span>
        )}
      </div>
      {error && <div className="text-sm text-bad">{error}</div>}
      <div className="min-h-0 flex-1">
        <InvoiceViewer key={shown.position} src={`/invoices/${invoiceId}/image${shown.position > 1 ? `?page=${shown.position}` : ""}`} type={shown.type} invoiceId={invoiceId} locked={locked} label={`Invoice page ${shown.position}`} />
      </div>
    </div>
  );
}

/** Zoomable, pannable invoice photo: wheel / pinch to zoom, drag to pan, double-click to toggle. */
export function InvoiceViewer({ src, type, invoiceId, locked, label = "Invoice" }: { src: string | null; type: string | null; invoiceId: string; locked: boolean; label?: string }) {
  if (!src) return <Placeholder invoiceId={invoiceId} locked={locked} />;
  if (type === "application/pdf") {
    return (
      <Card className="flex h-full flex-col overflow-hidden">
        <iframe src={src} title={`${label} PDF`} className="min-h-0 w-full flex-1 bg-surface-2" />
        <div className="flex justify-end border-t border-border px-3 py-2"><a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">Open PDF <ExternalLink className="size-3.5" /></a></div>
      </Card>
    );
  }
  return <ZoomImage src={src} label={label} />;
}

function ZoomImage({ src, label }: { src: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<View>({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; view: View; mid: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Keep the image covering the frame — no panning off into empty space. */
  const clamp = useCallback((n: View): View => {
    const el = box.current;
    if (!el) return n;
    const { width: w, height: h } = el.getBoundingClientRect();
    return { s: n.s, x: Math.min(0, Math.max(w * (1 - n.s), n.x)), y: Math.min(0, Math.max(h * (1 - n.s), n.y)) };
  }, []);

  /** Zoom to `s`, keeping the point (px, py) (frame coordinates) still. */
  const zoomAt = useCallback((view: View, s: number, px: number, py: number): View => {
    const ns = clampS(s);
    const k = ns / view.s;
    return clamp({ s: ns, x: px - (px - view.x) * k, y: py - (py - view.y) * k });
  }, [clamp]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Wheel needs a non-passive listener to stop the page scrolling while zooming.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0012));
      setV((view) => zoomAt(view, view.s * factor, p.x, p.y));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onResize = () => setV((view) => clamp(view));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const center = () => {
    const r = box.current!.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  };
  const step = (k: number) => setV((view) => { const c = center(); return zoomAt(view, view.s * k, c.x, c.y); });

  return (
    <Card className="relative h-full overflow-hidden">
      <div
        ref={box}
        className={cx("relative h-full w-full touch-none select-none overflow-hidden bg-surface-2", v.s > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in")}
        onPointerDown={(e) => {
          box.current!.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view: v, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
          }
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size === 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const start = pinch.current;
            const zoomed = zoomAt(start.view, start.view.s * (d / start.d), start.mid.x, start.mid.y);
            setV(clamp({ ...zoomed, x: zoomed.x + mid.x - start.mid.x, y: zoomed.y + mid.y - start.mid.y }));
          } else if (pointers.current.size === 1) {
            setV((view) => clamp({ ...view, x: view.x + p.x - prev.x, y: view.y + p.y - prev.y }));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (pointers.current.size === 0) setDragging(false);
        }}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); pinch.current = null; setDragging(false); }}
        onDoubleClick={(e) => { const p = local(e); setV((view) => (view.s > 1.05 ? { s: 1, x: 0, y: 0 } : zoomAt(view, 2.5, p.x, p.y))); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})`, transformOrigin: "0 0" }}
        />
      </div>
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm backdrop-blur">
        <ToolButton label="Zoom out" onClick={() => step(1 / 1.5)} disabled={v.s <= MIN}><Minus className="size-4" /></ToolButton>
        <span className="num w-11 text-center text-xs text-muted">{Math.round(v.s * 100)}%</span>
        <ToolButton label="Zoom in" onClick={() => step(1.5)} disabled={v.s >= MAX}><Plus className="size-4" /></ToolButton>
        <ToolButton label="Fit" onClick={() => setV({ s: 1, x: 0, y: 0 })} disabled={v.s === 1}><Maximize className="size-4" /></ToolButton>
        <a href={src} target="_blank" rel="noreferrer" aria-label="Open original" className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 sm:size-8"><ExternalLink className="size-4" /></a>
      </div>
    </Card>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 disabled:opacity-40 sm:size-8">
      {children}
    </button>
  );
}

function Placeholder({ invoiceId, locked }: { invoiceId: string; locked: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const upload = (f: File | null) => {
    if (!f) return;
    setError(null);
    start(async () => {
      const ready = await prepareUpload(f);
      if ("error" in ready) return setError(ready.error);
      const fd = new FormData();
      fd.set("file", ready);
      const res = await attachFile(invoiceId, fd);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };
  return (
    <>
      {/* Phone / tablet: one slim row instead of a tall empty frame. */}
      <Card className="flex items-center gap-3 px-3 py-2 xl:hidden">
        <ImageOff className="size-4 shrink-0 text-muted" />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-medium">No photo</span>
          <span className="text-muted"> · entered by hand</span>
          {error && <div className="text-xs text-bad">{error}</div>}
        </div>
        {!locked && (
          pending ? (
            <span className="flex h-10 items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Uploading…</span>
          ) : (
            <label className="relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
              <Camera className="size-4" />Add photo
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { upload(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
          )
        )}
      </Card>
      <PlaceholderFull locked={locked} pending={pending} error={error} upload={upload} />
    </>
  );
}

function PlaceholderFull({ locked, pending, error, upload }: { locked: boolean; pending: boolean; error: string | null; upload: (f: File | null) => void }) {
  return (
    <Card className="hidden h-full flex-col items-center justify-center gap-4 border-dashed px-6 py-10 text-center xl:flex">
      <span className="grid size-12 place-items-center rounded-xl bg-surface-2 text-muted"><ImageOff className="size-5" /></span>
      <div>
        <div className="text-sm font-medium">No photo of this invoice</div>
        <div className="mt-1 text-sm text-muted">It was entered by hand. Attach the photo or PDF to keep it with the record.</div>
      </div>
      {!locked && (
        <div className="w-full max-w-xs text-left">
          {pending ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Uploading…</div>
          ) : (
            <FileDrop
              accept="image/*,application/pdf"
              hint="Photo or PDF, up to 8 MB"
              onFile={upload}
            />
          )}
          {error && <div className="mt-2 text-sm text-bad">{error}</div>}
        </div>
      )}
    </Card>
  );
}
