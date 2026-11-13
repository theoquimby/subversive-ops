"use client";

import { Button, Card, Input } from "@/components/ui";
import type { PanelContext } from "@/server/services/kegs";
import { Camera, CameraOff, CloudOff, Keyboard, ScanLine } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { lookupKeg } from "./actions";
import { KegPanel } from "./keg-panel";
import { flushQueue, readQueue } from "./queue";

type Card_ = Extract<Awaited<ReturnType<typeof lookupKeg>>, { card: unknown }>["card"];

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** BarcodeDetector where the browser has it (Android Chrome, recent Safari); jsQR on a canvas everywhere else. */
async function makeDetector(): Promise<(video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>> {
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (BD) {
    try {
      const formats = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
      if (formats.includes("qr_code")) {
        const d = new BD({ formats: ["qr_code"] });
        return async (video) => (await d.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      // fall through to jsQR
    }
  }
  const jsQR = (await import("jsqr")).default;
  return async (video, canvas) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

/** Full-width camera that reads keg stickers, with typing the code as a fallback. */
export function Scanner({ ctx, role }: { ctx: PanelContext; role: "MANAGER" | "STAFF" }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "off" | "denied" | "none">("starting");
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [card, setCard] = useState<Card_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const lastText = useRef<{ t: string; at: number } | null>(null);
  const queued = useQueueCount();

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const lookup = useCallback((text: string) => {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      setError(null);
      try {
        const r = await lookupKeg(text);
        if ("error" in r) {
          setError(r.error);
          return;
        }
        try { if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) navigator.vibrate?.(40); } catch { /* not supported */ }
        stop();
        setCamera("off");
        setCard(r.card);
      } catch {
        setError("No signal. Try again in a moment, or move closer to the door.");
      } finally {
        busy.current = false;
      }
    });
  }, [stop]);

  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setCamera("none"); setManual(true); return; }
    setCamera("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play().catch(() => undefined);
      setCamera("on");
    } catch (e) {
      setCamera((e as Error).name === "NotAllowedError" ? "denied" : "none");
      setManual(true);
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return stop;
  }, [startCamera, stop]);

  // Read frames ~8 times a second while the camera is on.
  useEffect(() => {
    if (camera !== "on") return;
    let alive = true;
    let detect: Awaited<ReturnType<typeof makeDetector>> | null = null;
    const tick = async () => {
      if (!alive) return;
      try {
        detect ??= await makeDetector();
        if (video.current && canvas.current && !busy.current) {
          const text = await detect(video.current, canvas.current);
          if (text && !(lastText.current && lastText.current.t === text && Date.now() - lastText.current.at < 2500)) {
            lastText.current = { t: text, at: Date.now() };
            lookup(text);
          }
        }
      } catch {
        // a bad frame; keep going
      }
      if (alive) setTimeout(tick, 120);
    };
    void tick();
    return () => { alive = false; };
  }, [camera, lookup]);

  const again = () => {
    setCard(null);
    setCode("");
    lastText.current = null;
    void startCamera();
  };

  if (card) {
    return (
      <div className="mx-auto max-w-md">
        <KegPanel card={card} ctx={ctx} role={role} onDone={again} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      {queued > 0 && <QueueNote count={queued} />}
      <div data-tour="kegs.camera" className="relative aspect-[3/4] max-h-[62dvh] w-full overflow-hidden rounded-3xl bg-black sm:aspect-square">
        <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" aria-label="Camera" />
        <canvas ref={canvas} className="hidden" />
        {camera === "on" && (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative size-[62%] max-w-72 rounded-3xl border-[3px] border-white/85 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]">
              <div className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse bg-white/70" />
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 p-4 text-center text-sm font-medium text-white/90">
          {pending ? "Looking it up…" : camera === "on" ? "Point at the keg's sticker" : camera === "starting" ? "Starting the camera…" : camera === "denied" ? "Camera is blocked for this site" : camera === "none" ? "No camera here" : ""}
        </div>
        {(camera === "denied" || camera === "none" || camera === "off") && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
            <div>
              <CameraOff className="mx-auto size-8 opacity-70" />
              <p className="mt-2 text-sm opacity-90">{camera === "denied" ? "Allow the camera in your browser's settings for this site, or type the code below." : "Type the code printed under the QR code."}</p>
              {camera !== "none" && <Button className="mt-3" onClick={() => void startCamera()}><Camera className="size-4" /> Try the camera</Button>}
            </div>
          </div>
        )}
      </div>

      {error && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm font-medium text-bad">{error}</p>}

      {manual ? (
        <Card className="p-4" data-tour="kegs.manual">
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) lookup(code); }} className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code, e.g. 7Q3-MX" aria-label="Keg code" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} className="num h-12 text-lg tracking-wider sm:h-12" autoFocus />
            <Button type="submit" variant="primary" size="lg" className="h-12" disabled={pending || !code.trim()}>Find</Button>
          </form>
          <p className="mt-2 text-xs text-muted">Old stickers from the previous keg app work too — type what&apos;s printed on them.</p>
        </Card>
      ) : (
        <Button variant="secondary" size="lg" className="h-12 w-full" onClick={() => setManual(true)} data-tour="kegs.type"><Keyboard className="size-4" /> Type the code instead</Button>
      )}

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
