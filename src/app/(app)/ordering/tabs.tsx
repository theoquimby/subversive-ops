"use client";

import { cx } from "@/components/ui";
import { useState, type ReactNode } from "react";

type Tab = "suppliers" | "orders";

/**
 * Suppliers | Orders. Only the open tab is mounted, so its table owns the keyboard
 * (j/k, /, x). The choice lives in the URL (?tab=orders) for links and reloads.
 */
export function OrderingTabs({ initial, suppliers, orders, counts }: { initial: Tab; suppliers: ReactNode; orders: ReactNode; counts: { suppliers: number; open: number } }) {
  const [tab, setTab] = useState<Tab>(initial);
  const pick = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    if (t === "orders") u.searchParams.set("tab", "orders");
    else u.searchParams.delete("tab");
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  };
  const item = (t: Tab, label: string, n: number, hint: string) => (
    <button
      type="button"
      role="tab"
      id={`ordering-tab-${t}`}
      aria-selected={tab === t}
      aria-controls={`ordering-panel-${t}`}
      onClick={() => pick(t)}
      className={cx(
        "-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors sm:h-10",
        tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
      )}
      title={hint}
    >
      {label}
      <span className={cx("num rounded-md px-1.5 py-0.5 text-xs", tab === t ? "bg-surface-2 text-ink-2" : "text-muted")}>{n}</span>
    </button>
  );
  return (
    <div>
      <div role="tablist" aria-label="Ordering" className="mb-4 flex gap-5 border-b border-border">
        {item("suppliers", "Suppliers", counts.suppliers, "Every supplier, its next deadline and where its order stands")}
        {item("orders", "Orders", counts.open, "Purchase orders: drafts, sent and received")}
      </div>
      <div role="tabpanel" id={`ordering-panel-${tab}`} aria-labelledby={`ordering-tab-${tab}`}>
        {tab === "suppliers" ? suppliers : orders}
      </div>
    </div>
  );
}
