"use client";

/** App-styled confirm dialog (replaces window.confirm): `const ok = await confirm({...})`. */

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "./ui";

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
  const okRef = useRef<HTMLButtonElement>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  useEffect(() => {
    if (!state) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center" onMouseDown={() => close(false)}>
          <div role="alertdialog" aria-modal="true" aria-label={state.title} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl">
            <div className="text-base font-semibold">{state.title}</div>
            {state.body && <div className="mt-1.5 text-sm text-muted">{state.body}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button ref={okRef} variant={state.danger ? "danger" : "primary"} className={state.danger ? "bg-bad text-white hover:bg-bad/90 hover:text-white" : ""} onClick={() => close(true)}>{state.confirmLabel ?? "Confirm"}</Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
