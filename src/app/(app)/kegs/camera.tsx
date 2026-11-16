"use client";

import { Button } from "@/components/ui";
import { Camera, CameraOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The phone camera as a QR reader, shared by scanning one keg and scanning
 * many. BarcodeDetector where the browser has it (Android Chrome, recent
 * Safari); jsQR on a canvas everywhere else.
 */

export type CameraState = "starting" | "on" | "off" | "denied" | "none";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

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

/**
 * Start the camera and call `onText` for each sticker read. The same sticker
 * held in view isn't reported again for 2.5 seconds; `paused` skips reading
 * while the last one is being dealt with.
 */
export function useKegCamera(onText: (text: string) => void, paused: () => boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const last = useRef<{ t: string; at: number } | null>(null);
  const handler = useRef(onText);
  const isPaused = useRef(paused);
  const [state, setState] = useState<CameraState>("starting");
  useEffect(() => {
    handler.current = onText;
    isPaused.current = paused;
  });

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setState("none"); return; }
    setState("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      const v = video.current;
      if (!v) { s.getTracks().forEach((t) => t.stop()); return; }
      v.srcObject = s;
      await v.play().catch(() => undefined);
      setState("on");
    } catch (e) {
      setState((e as Error).name === "NotAllowedError" ? "denied" : "none");
    }
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  // Read frames ~8 times a second while the camera is on.
  useEffect(() => {
    if (state !== "on") return;
    let alive = true;
    let detect: Awaited<ReturnType<typeof makeDetector>> | null = null;
    const tick = async () => {
      if (!alive) return;
      try {
        detect ??= await makeDetector();
        if (video.current && canvas.current && !isPaused.current()) {
          const text = await detect(video.current, canvas.current);
          if (text && !(last.current && last.current.t === text && Date.now() - last.current.at < 2500)) {
            last.current = { t: text, at: Date.now() };
            handler.current(text);
          }
        }
      } catch {
        // a bad frame; keep going
      }
      if (alive) setTimeout(tick, 120);
    };
    void tick();
    return () => { alive = false; };
  }, [state]);

  return {
    video,
    canvas,
    state,
    start,
    /** Turn the camera off (after a keg is found, so the card isn't fighting the viewfinder). */
    off: () => { stop(); setState("off"); },
    /** Forget the last sticker read, so the same one can be read again straight away. */
    forget: () => { last.current = null; },
  };
}

export type KegCamera = ReturnType<typeof useKegCamera>;

/** The viewfinder: video, an aiming square, a line of status, and what to do when there's no camera. */
export function CameraFrame({ cam, status, compact }: { cam: KegCamera; status?: string; compact?: boolean }) {
  const s = cam.state;
  // With no camera to show, a tall black box only pushes the type-the-code box off the screen.
  const noCamera = s === "denied" || s === "none";
  return (
    <div data-tour="kegs.camera" className={`relative w-full overflow-hidden rounded-3xl bg-black ${noCamera ? "h-40" : compact ? "aspect-[4/3] max-h-[42dvh]" : "aspect-[3/4] max-h-[62dvh] sm:aspect-square"}`}>
      <video ref={cam.video} playsInline muted className="absolute inset-0 size-full object-cover" aria-label="Camera" />
      <canvas ref={cam.canvas} className="hidden" />
      {s === "on" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className={`relative rounded-3xl border-[3px] border-white/85 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)] ${compact ? "size-[52%] max-w-56" : "size-[62%] max-w-72"}`}>
            <div className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse bg-white/70" />
          </div>
        </div>
      )}
      <div className={`absolute inset-x-0 bottom-0 p-4 text-center text-sm font-medium text-white/90 ${noCamera ? "hidden" : ""}`}>
        {status ?? (s === "on" ? "Point at the keg's sticker" : s === "starting" ? "Starting the camera…" : s === "denied" ? "Camera is blocked for this site" : s === "none" ? "No camera here" : "")}
      </div>
      {(s === "denied" || s === "none" || s === "off") && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
          <div>
            <CameraOff className="mx-auto size-7 opacity-70" />
            <p className="mt-2 text-sm opacity-90">{s === "denied" ? "The camera is blocked for this site. Allow it in your browser's settings, or type the code below." : s === "none" ? "No camera here. Type the code printed under the QR code." : "Type the code printed under the QR code."}</p>
            {s !== "none" && <Button className="mt-3" onClick={() => void cam.start()}><Camera className="size-4" /> Try the camera</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A short buzz when a sticker is read, on phones that allow it. */
export function buzz(ms = 40) {
  try {
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
