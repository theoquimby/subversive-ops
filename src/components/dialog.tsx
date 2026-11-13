"use client";

/** App-styled confirm dialog (replaces window.confirm): `const ok = await confirm({...})`. */

import { cn } from "@/lib/cn";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { usePresence } from "./motion";

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const Ctx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  // The last dialog stays rendered while it animates out (backdrop fade, panel settles down 4px).
  const [shown, setShown] = useState<ConfirmOptions | null>(null);
  const { mounted, closing } = usePresence(!!state, 140);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => { setShown(o); setState({ ...o, resolve }); }), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  useEffect(() => {
    if (!state) return;
    // Destructive dialogs start on Cancel so a stray Enter can't delete anything.
    (state.danger ? cancelRef : okRef).current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Ctx.Provider value={confirm}>
      {children}
      {mounted && shown && (
        <div data-closing={closing || undefined} className={cn("dialog-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center", closing && "pointer-events-none")} onMouseDown={() => close(false)}>
          <div role="alertdialog" aria-modal="true" aria-label={shown.title} data-closing={closing || undefined} onMouseDown={(e) => e.stopPropagation()} className="dialog-panel dialog-sheet w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl">
            <div className="text-base font-semibold">{shown.title}</div>
            {shown.body && <div className="mt-1.5 text-sm text-muted">{shown.body}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <Button ref={cancelRef} variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button ref={okRef} variant={shown.danger ? "danger" : "primary"} className={shown.danger ? "bg-bad text-white hover:bg-bad/90 hover:text-white" : ""} onClick={() => close(true)}>{shown.confirmLabel ?? "Confirm"}</Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
