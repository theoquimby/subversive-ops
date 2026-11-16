"use client";

import { Button, cx, Input } from "@/components/ui";
import { abvFromText, formatGravity, GRAVITY_UNIT_LABEL, gravityInputText, parseGravity, type GravityUnit } from "@/domain/gravity";
import { Calculator, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setGravityUnitAction } from "./actions";

/**
 * A gravity typed in the brewery's unit (°P or SG), kept as SG. What's typed
 * stays as typed until it is a gravity; "15.5P" or "1.063" work in either unit.
 */
export function GravityInput({ value, onChange, unit, label, placeholder, className, big }: { value: number | null; onChange: (sg: number | null) => void; unit: GravityUnit; label: string; placeholder?: string; className?: string; big?: boolean }) {
  const [text, setText] = useState(gravityInputText(value, unit));
  const last = useRef<number | null>(value);
  const lastUnit = useRef(unit);
  // Shown again when the value changes from outside, or the brewery switches °P / SG.
  useEffect(() => {
    if (value !== last.current || unit !== lastUnit.current) {
      last.current = value;
      lastUnit.current = unit;
      setText(gravityInputText(value, unit));
    }
  }, [value, unit]);
  const bad = text.trim() !== "" && parseGravity(text, unit) == null;
  return (
    <div className={cx("relative", className)}>
      <Input
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={bad || undefined}
        value={text}
        placeholder={placeholder}
        className={cx("num pr-10 text-right", big && "h-12 text-lg sm:h-11 sm:text-base", bad && "border-bad")}
        onChange={(e) => {
          setText(e.target.value);
          const sg = e.target.value.trim() === "" ? null : parseGravity(e.target.value, unit);
          if (e.target.value.trim() === "" || sg != null) {
            last.current = sg;
            onChange(sg);
          }
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">{GRAVITY_UNIT_LABEL[unit]}</span>
    </div>
  );
}

/** °P | SG for the whole brewery. */
export function GravityUnitToggle({ unit }: { unit: GravityUnit }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useState(unit);
  const pick = (u: GravityUnit) => {
    if (u === shown) return;
    setShown(u);
    start(async () => {
      const res = await setGravityUnitAction(u);
      if (res.error) setShown(unit);
      router.refresh();
    });
  };
  return (
    <div role="radiogroup" aria-label="Gravity in" className={cx("inline-flex h-10 items-center rounded-lg border border-border-strong bg-surface p-0.5 sm:h-9", pending && "opacity-70")}>
      {(["plato", "sg"] as GravityUnit[]).map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={shown === u}
          onClick={() => pick(u)}
          className={cx("h-full min-w-11 rounded-md px-2.5 text-sm font-medium transition-colors", shown === u ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2")}
        >
          {GRAVITY_UNIT_LABEL[u]}
        </button>
      ))}
    </div>
  );
}

/** Brew Manager's ABV calculator: OG and FG in the brewery's unit, the standard and the alternate ABV. */
export function AbvCalculator({ unit, og, fg, className }: { unit: GravityUnit; og?: number | null; fg?: number | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [ogText, setOg] = useState(gravityInputText(og, unit));
  const [fgText, setFg] = useState(gravityInputText(fg, unit));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const r = abvFromText(ogText, fgText, unit);
  const ph = unit === "plato" ? ["e.g. 15.5", "e.g. 2.5"] : ["e.g. 1.063", "e.g. 1.010"];
  return (
    <>
      <Button type="button" className={cx("h-10 sm:h-9", className)} onClick={() => setOpen(true)}>
        <Calculator className="size-4" />ABV
      </Button>
      {open && (
        <div className="dialog-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center" onMouseDown={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="ABV calculator" onMouseDown={(e) => e.stopPropagation()} className="dialog-panel dialog-sheet w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">ABV calculator</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-2 inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">OG ({GRAVITY_UNIT_LABEL[unit]})</span>
                <Input ref={first} inputMode="decimal" className="num h-12 text-right text-lg sm:h-11" value={ogText} placeholder={ph[0]} onChange={(e) => setOg(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">FG ({GRAVITY_UNIT_LABEL[unit]})</span>
                <Input inputMode="decimal" className="num h-12 text-right text-lg sm:h-11" value={fgText} placeholder={ph[1]} onChange={(e) => setFg(e.target.value)} />
              </label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-2 p-4 text-center">
                <div className="text-xs text-muted">Standard ABV</div>
                <div className="num mt-1 text-3xl font-semibold tracking-tight">{r ? `${r.standard.toFixed(2)}%` : "—"}</div>
                <div className="mt-2 text-[0.7rem] leading-snug text-muted">(OG − FG) × 131.25</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-4 text-center">
                <div className="text-xs text-muted">Alternate ABV</div>
                <div className="num mt-1 text-3xl font-semibold tracking-tight">{r ? `${r.alternate.toFixed(2)}%` : "—"}</div>
                <div className="mt-2 text-[0.7rem] leading-snug text-muted">(76.08 × (OG − FG) ÷ (1.775 − OG)) × (FG ÷ 0.794)</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              {r ? `OG ${formatGravity(r.og, unit === "plato" ? "sg" : "plato")}, FG ${formatGravity(r.fg, unit === "plato" ? "sg" : "plato")}. ` : ""}
              {unit === "plato" ? "°P is turned into SG first, then the formulas use SG." : "Type °P with a P (15.5P) if that's what you have."} The alternate is closer for strong beers.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
