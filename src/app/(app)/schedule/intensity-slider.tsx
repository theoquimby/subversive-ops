"use client";

import { cx } from "@/components/ui";
import { useRef } from "react";

/** Lean ↔ generous staffing slider (0–100). Pointer + keyboard; no native range input. */
export function IntensitySlider({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef(value);

  const fromX = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    const v = Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 20) * 5;
    last.current = v;
    onChange(v);
  };
  const set = (v: number) => {
    const n = Math.max(0, Math.min(100, v));
    last.current = n;
    onChange(n);
    onCommit?.(n);
  };
  const label = value < 35 ? "Lean" : value > 65 ? "Generous" : "Balanced";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>Lean</span>
        <span className="font-medium text-ink">{label}</span>
        <span>Generous</span>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Staffing level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={label}
        className="relative h-10 cursor-pointer touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          fromX(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && fromX(e.clientX)}
        onPointerUp={() => {
          dragging.current = false;
          onCommit?.(last.current);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); set(value - 5); }
          else if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); set(value + 5); }
          else if (e.key === "Home") { e.preventDefault(); set(0); }
          else if (e.key === "End") { e.preventDefault(); set(100); }
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-ink" style={{ width: `${value}%` }} />
        </div>
        <div className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 bg-border-strong" />
        <div
          className={cx("absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-surface shadow-sm transition-transform", dragging.current && "scale-110")}
          style={{ left: `${value}%` }}
        />
      </div>
    </div>
  );
}
