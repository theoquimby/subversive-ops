"use client";

/** Drag-and-drop / tap-to-choose file picker styled like the rest of the app. */

import clsx from "clsx";
import { FileUp, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export interface FileDropHandle { file: File | null; clear: () => void }

export const FileDrop = forwardRef<FileDropHandle, { accept: string; hint?: string; onFile?: (f: File | null) => void; capture?: boolean }>(function FileDrop({ accept, hint, onFile, capture }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const set = (f: File | null) => { setFile(f); onFile?.(f); };
  useImperativeHandle(ref, () => ({ file, clear: () => { set(null); if (input.current) input.current.value = ""; } }), [file]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) set(f); }}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      role="button"
      tabIndex={0}
      className={clsx("flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-4 transition-colors", over ? "border-ink bg-surface-2" : "border-border-strong hover:border-ink-2/50 hover:bg-surface-2/50")}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><FileUp className="size-4" /></span>
      <div className="min-w-0 flex-1">
        {file ? (
          <>
            <div className="truncate text-sm font-medium">{file.name}</div>
            <div className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB · tap to change</div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium">Drop a file here, or tap to choose</div>
            {hint && <div className="text-xs text-muted">{hint}</div>}
          </>
        )}
      </div>
      {file && (
        <button type="button" aria-label="Remove file" onClick={(e) => { e.stopPropagation(); set(null); if (input.current) input.current.value = ""; }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><X className="size-4" /></button>
      )}
      <input ref={input} type="file" accept={accept} capture={capture ? "environment" : undefined} className="sr-only" tabIndex={-1} onChange={(e) => set(e.target.files?.[0] ?? null)} />
    </div>
  );
});
