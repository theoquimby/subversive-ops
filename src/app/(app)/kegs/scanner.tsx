"use client";

import { Button, Card, cx, Input } from "@/components/ui";
import { KEG_SIZE_LIST } from "@/domain/kegs";
import type { PanelContext } from "@/server/services/kegs";
import { CloudOff, Keyboard, ScanLine } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { adoptKeg, lookupKeg } from "./actions";
import { buzz, CameraFrame, useKegCamera } from "./camera";
import { KegPanel } from "./keg-panel";
import { flushQueue, readQueue } from "./queue";
import { ScanMany } from "./scan-many";

type Card_ = Extract<Awaited<ReturnType<typeof lookupKeg>>, { card: unknown }>["card"];

/** Scan one keg and act on it, or switch to scanning a whole stack the same way. */
export function Scanner({ ctx, role, fill }: { ctx: PanelContext; role: "MANAGER" | "STAFF"; fill?: { beerId: string; batchCode: string } }) {
  const [many, setMany] = useState(!!fill);
  const switcher = (
    <div role="tablist" aria-label="How to scan" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" data-tour="kegs.scan-mode">
      {[{ on: !many, label: "One keg", set: false }, { on: many, label: "Many kegs", set: true }].map((t) => (
        <button key={t.label} role="tab" aria-selected={t.on} onClick={() => setMany(t.set)} className={cx("h-10 rounded-xl text-sm font-medium transition-colors duration-120", t.on ? "bg-surface text-ink shadow-sm" : "text-ink-2")}>
          {t.label}
        </button>
      ))}
    </div>
  );
  return <div className="mx-auto max-w-md">{many ? <ScanMany ctx={ctx} role={role} switcher={switcher} fill={fill} /> : <ScanOne ctx={ctx} role={role} switcher={switcher} />}</div>;
}

/** Full-width camera that reads keg stickers, with typing the code as a fallback. */
function ScanOne({ ctx, role, switcher }: { ctx: PanelContext; role: "MANAGER" | "STAFF"; switcher: React.ReactNode }) {
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [card, setCard] = useState<Card_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A sticker the app doesn't know, waiting for "add it" or "scan again". */
  const [unknown, setUnknown] = useState<string | null>(null);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const queued = useQueueCount();

  const lookup = useCallback((text: string) => {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      setError(null);
      try {
        const r = await lookupKeg(text);
        if ("error" in r) {
          if (r.canAdd) { buzz(); setUnknown(text); setSizeId(null); } else setError(r.error);
          return;
        }
        buzz();
        cam.off();
        setCard(r.card);
      } catch {
        setError("No signal. Try again in a moment, or move closer to the door.");
      } finally {
        busy.current = false;
      }
    });
    // cam is stable enough for this: its methods only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cam = useKegCamera(lookup, () => busy.current || unknown !== null);
  useEffect(() => {
    if (cam.state === "denied" || cam.state === "none") setManual(true);
  }, [cam.state]);

  const again = () => {
    setCard(null);
    setCode("");
    setUnknown(null);
    setError(null);
    cam.forget();
    void cam.start();
  };

  const add = () =>
    start(async () => {
      if (!unknown || !sizeId) return;
      setError(null);
      try {
        const r = await adoptKeg(unknown, sizeId);
        if ("error" in r) { setError(r.error); return; }
        cam.off();
        setUnknown(null);
        setCard(r.card);
      } catch {
        setError("No signal. Try again in a moment.");
      }
    });

  if (card) return <KegPanel card={card} ctx={ctx} role={role} onDone={again} />;

  return (
    <div className="space-y-4">
      {switcher}
      {queued > 0 && <QueueNote count={queued} />}
      <CameraFrame cam={cam} status={pending ? "Looking it up…" : unknown ? "Sticker read" : undefined} />

      {error && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm font-medium text-bad">{error}</p>}

      {unknown && (
        <Card className="p-4" role="status">
          <div className="font-semibold">This sticker isn&apos;t in the app yet</div>
          <p className="mt-1 text-sm text-ink-2">Add it as a new keg. It keeps this sticker, and gets one of our codes too for when the sticker wears out.</p>
          <div className="mt-3 text-[0.8rem] font-medium text-ink-2">What size is it?</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {KEG_SIZE_LIST.map((s) => (
              <button key={s.id} type="button" aria-pressed={sizeId === s.id} onClick={() => setSizeId(s.id)} className={cx("h-10 rounded-full border px-3 text-sm font-medium", sizeId === s.id ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2")}>
                {s.short}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" className="h-12" onClick={again} disabled={pending}>Not a keg</Button>
            <Button variant="primary" size="lg" className="h-12" onClick={add} disabled={pending || !sizeId}>{pending ? "Adding…" : "Add this keg"}</Button>
          </div>
        </Card>
      )}

      {!unknown && (manual ? (
        <Card className="p-4" data-tour="kegs.manual">
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) lookup(code); }} className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code, e.g. 7Q3-MX" aria-label="Keg code" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} className="num h-12 text-lg tracking-wider sm:h-12" autoFocus />
            <Button type="submit" variant="primary" size="lg" className="h-12" disabled={pending || !code.trim()}>Find</Button>
          </form>
          <p className="mt-2 text-xs text-muted">Old stickers from the previous keg app work too. Scan them, or type what&apos;s printed on them.</p>
        </Card>
      ) : (
        <Button variant="secondary" size="lg" className="h-12 w-full" onClick={() => setManual(true)} data-tour="kegs.type"><Keyboard className="size-4" /> Type the code instead</Button>
      ))}

      <div className="grid grid-cols-2 gap-2">
        <Link href="/kegs" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm font-medium active:bg-surface-2"><ScanLine className="size-4 text-area" /> Taps</Link>
        <Link href="/kegs/cooler" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm font-medium active:bg-surface-2">Walk-in</Link>
      </div>
    </div>
  );
}

/** How many actions are waiting on this phone; sends them when the connection comes back. */
export function useQueueCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const update = () => setN(readQueue().length);
    const flush = () => { void flushQueue().then(update); };
    update();
    flush();
    window.addEventListener("kegs-queue", update);
    window.addEventListener("online", flush);
    const t = setInterval(() => readQueue().length && navigator.onLine && flush(), 20_000);
    return () => { window.removeEventListener("kegs-queue", update); window.removeEventListener("online", flush); clearInterval(t); };
  }, []);
  return n;
}

export function QueueNote({ count }: { count: number }) {
  return (
    <p className="flex items-center gap-2 rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
      <CloudOff className="size-4" /> {count} scan{count === 1 ? "" : "s"} waiting to send. They go as soon as there&apos;s signal.
    </p>
  );
}

export function QueueWatcher() {
  const n = useQueueCount();
  return n > 0 ? <QueueNote count={n} /> : null;
}
