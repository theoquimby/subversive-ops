"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { cx, Input } from "@/components/ui";

/** Search the notes as you type (kept in the URL as ?q= so it survives a reload). */
export function NoteSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(initial);
  const [pending, start] = useTransition();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      start(() => router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false }));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes: an item, a name, “ice machine”…" aria-label="Search notes" className="pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden" />
      <span className="absolute top-1/2 right-1 -translate-y-1/2">
        {pending ? (
          <Loader2 aria-hidden className="m-2.5 size-4 text-muted motion-safe:animate-spin" />
        ) : q ? (
          <button type="button" onClick={() => setQ("")} className={cx("grid size-9 place-items-center rounded-md text-muted hover:text-ink")} aria-label="Clear search">
            <X className="size-4" />
          </button>
        ) : null}
      </span>
    </div>
  );
}
