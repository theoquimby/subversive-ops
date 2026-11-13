"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Every data table in the app gets resizable columns, with no per-page code:
 * a drag handle on the right edge of each header cell (mouse, pen or finger).
 * Widths are remembered per page and table in this browser; double-click (or
 * double-tap) a handle to reset that column. Tables lay out automatically, so a
 * column can't be squeezed below its content — text wraps instead of being cut
 * off. Opt a table out with `data-no-resize`.
 */
export function TableResize() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.querySelector("main");
    if (!root) return;
    const tables = new WeakSet<HTMLTableElement>();
    let index = 0;

    const keyFor = (table: HTMLTableElement, n: number) => {
      const heads = headerCells(table).map((th) => (th.textContent ?? "").trim().slice(0, 24)).join("|");
      return `colw:${pathname}:${n}:${heads}`;
    };
    const load = (key: string): Record<string, number> => {
      try {
        return JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        return {};
      }
    };
    const save = (key: string, widths: Record<string, number>) => {
      try {
        if (Object.keys(widths).length) localStorage.setItem(key, JSON.stringify(widths));
        else localStorage.removeItem(key);
      } catch {
        /* storage blocked: widths just aren't remembered */
      }
    };
    const setWidth = (th: HTMLTableCellElement, px: number | null) => {
      th.style.width = px == null ? "" : `${px}px`;
      th.style.minWidth = px == null ? "" : `${px}px`;
    };

    const enhance = (table: HTMLTableElement) => {
      if (tables.has(table) || table.hasAttribute("data-no-resize") || table.closest("[data-no-resize]")) return;
      const heads = headerCells(table);
      if (heads.length < 2) return;
      tables.add(table);
      table.dataset.resizable = "";
      const key = keyFor(table, index++);
      const widths = load(key);
      heads.forEach((th, col) => {
        if (widths[col]) setWidth(th, widths[col]);
        const handle = document.createElement("span");
        handle.className = "col-resizer";
        handle.setAttribute("aria-hidden", "true");
        handle.title = "Drag to resize · double-click to reset";
        let startX = 0;
        let startW = 0;
        let lastTap = 0;
        const move = (e: PointerEvent) => {
          const w = Math.max(48, Math.round(startW + e.clientX - startX));
          setWidth(th, w);
          widths[col] = w;
        };
        const up = (e: PointerEvent) => {
          handle.releasePointerCapture(e.pointerId);
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          document.documentElement.classList.remove("col-resizing");
          // Auto layout may keep the column wider than asked (its content needs it): remember what it really is.
          if (widths[col]) widths[col] = Math.round(th.getBoundingClientRect().width);
          save(key, widths);
        };
        handle.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const now = Date.now();
          if (now - lastTap < 350) {
            delete widths[col];
            setWidth(th, null);
            save(key, widths);
            lastTap = 0;
            return;
          }
          lastTap = now;
          startX = e.clientX;
          startW = th.getBoundingClientRect().width;
          handle.setPointerCapture(e.pointerId);
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", up);
          handle.addEventListener("pointercancel", up);
          document.documentElement.classList.add("col-resizing");
        });
        // Header cells are often sort buttons or links: a click on the handle shouldn't trigger them.
        handle.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
        th.appendChild(handle);
      });
    };

    const scan = () => root.querySelectorAll("table").forEach((t) => enhance(t as HTMLTableElement));
    // Wait for React to finish hydrating before touching its DOM (handles added
    // earlier would make the server and client HTML differ). Streamed sections
    // arrive later, so new tables are picked up a moment after they settle.
    let timer = 0;
    const later = (ms: number) => { window.clearTimeout(timer); timer = window.setTimeout(scan, ms); };
    const onLoad = () => later(350);
    if (document.readyState === "complete") later(350);
    else window.addEventListener("load", onLoad, { once: true });
    const observer = new MutationObserver(() => later(450));
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); window.clearTimeout(timer); window.removeEventListener("load", onLoad); };
  }, [pathname]);

  return null;
}

/** The header row's cells: the last row of <thead>, or the first row if it's all <th>. */
function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const row = table.tHead?.rows[table.tHead.rows.length - 1] ?? table.rows[0];
  if (!row) return [];
  const cells = Array.from(row.cells);
  return cells.every((c) => c.tagName === "TH") ? (cells as HTMLTableCellElement[]) : [];
}
