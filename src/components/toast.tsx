"use client";

/**
 * A quiet confirmation that floats just above the tab bar (where the thumb
 * is), so "Saved" is seen even when the button that did it is far down the
 * page. One at a time; it fades after a few seconds. The live region is
 * always mounted so screen readers announce every message.
 *
 *   const [toast, show] = useToast();
 *   show("Picked up Fri 4p–10p");            // good
 *   show("Saved on this phone", "queued");   // waiting for signal
 *   return <>{toast}…</>;
 */

import { cn } from "@/lib/cn";
import { AlertCircle, Check, CloudOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ToastTone = "good" | "queued" | "bad";

const ICON = { good: Check, queued: CloudOff, bad: AlertCircle };

export function useToast(ms = 3800): [React.ReactNode, (text: string, tone?: ToastTone) => void] {
  const [msg, setMsg] = useState<{ id: number; text: string; tone: ToastTone } | null>(null);
  const [mounted, setMounted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    setMounted(true);
    return () => clearTimeout(timer.current);
  }, []);
  const show = useCallback((text: string, tone: ToastTone = "good") => {
    clearTimeout(timer.current);
    setMsg({ id: Date.now(), text, tone });
    timer.current = setTimeout(() => setMsg(null), tone === "bad" ? ms * 1.6 : ms);
  }, [ms]);
  if (!mounted) return [null, show];
  const Icon = msg ? ICON[msg.tone] : Check;
  const node = createPortal(
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar)+0.75rem)] z-[45] flex justify-center px-4 lg:bottom-6 lg:pl-60">
      {msg && (
        <div
          key={msg.id}
          onClick={() => setMsg(null)}
          className={cn(
            "pointer-events-auto flex max-w-md animate-rise-in items-center gap-2.5 rounded-2xl px-4 py-3 text-[0.95rem] font-medium shadow-[0_8px_30px_rgb(0_0_0/0.18)] motion-reduce:animate-none",
            msg.tone === "good" && "bg-primary text-primary-ink",
            msg.tone === "queued" && "bg-warn-bg text-warn ring-1 ring-warn/25",
            msg.tone === "bad" && "bg-bad-bg text-bad ring-1 ring-bad/25",
          )}
        >
          <Icon className={cn("size-[1.1rem] shrink-0", msg.tone === "good" && "animate-pop motion-reduce:animate-none")} strokeWidth={2.4} aria-hidden />
          <span>{msg.text}</span>
        </div>
      )}
    </div>,
    document.body,
  );
  return [node, show];
}
