"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useConfirm } from "./dialog";

/**
 * Don't lose typed work. While `dirty`, closing or reloading the tab asks
 * first, and so does clicking a link inside the app (sidebar, back link, a
 * row). Returns `allowLeave()` to call just before navigating away on purpose
 * (after a save).
 */
export function useUnsavedGuard(dirty: boolean, opts: { title?: string; body?: string } = {}) {
  const router = useRouter();
  const confirm = useConfirm();
  const leaving = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void confirm({ title: opts.title ?? "Leave without saving?", body: opts.body ?? "What you've typed here will be lost.", confirmLabel: "Leave", danger: true }).then((ok) => {
        if (!ok) return;
        leaving.current = true;
        router.push(url.pathname + url.search + url.hash);
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, confirm, router, opts.title, opts.body]);
  return { allowLeave: () => { leaving.current = true; } };
}

/**
 * ⌘S / Ctrl+S saves, and ⌘Enter / Ctrl+Enter too, while `enabled` (the
 * browser's own Save page dialog never opens on a page that uses this).
 */
export function useSaveShortcut(save: () => void, enabled = true) {
  const fn = useRef(save);
  fn.current = save;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === "s" || e.key === "S" || e.key === "Enter") {
        e.preventDefault();
        fn.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/**
 * Keep a form's typed values on this phone or computer, so a reload, a closed
 * tab or a lost connection doesn't wipe them. `key` names the form (include
 * the record id). Returns the saved value (once, on first render) and `clear()`
 * for after a successful save.
 */
export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`draft:${key}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; data: T };
    // Drafts older than a week are stale.
    if (Date.now() - v.at > 7 * 86_400_000) return null;
    return v.data;
  } catch {
    return null;
  }
}

export function useDraftStorage<T>(key: string, data: T, active: boolean) {
  useEffect(() => {
    try {
      if (active) localStorage.setItem(`draft:${key}`, JSON.stringify({ at: Date.now(), data }));
      else localStorage.removeItem(`draft:${key}`);
    } catch {
      // Private mode or storage full: nothing to keep.
    }
  }, [key, data, active]);
  return { clear: () => { try { localStorage.removeItem(`draft:${key}`); } catch { /* nothing kept */ } } };
}
