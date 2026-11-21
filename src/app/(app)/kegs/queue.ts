"use client";

/**
 * Offline-tolerant keg actions. Each action gets an id made on the phone; if
 * sending fails (walk-in with no signal), it waits in this phone's storage
 * and is retried when the connection comes back. The server applies an id
 * once, so a retry never doubles a kick.
 */

import { kegAction, scanMany, type KegActionForm, type ScanManyForm } from "./actions";

const KEY = "kegs.queue.v1";

/** A one-keg action (the keg card), or one scan of a stack ("Scan many"). Both are applied once per clientId. */
export type Queued = ((KegActionForm & { kind?: "action" }) | (ScanManyForm & { kind: "many" })) & { clientId: string; at: number; label: string };

export function newClientId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function readQueue(): Queued[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // Private mode or storage full: nothing to keep.
  }
  window.dispatchEvent(new Event("kegs-queue"));
}

export function enqueue(item: Queued) {
  writeQueue([...readQueue().filter((x) => x.clientId !== item.clientId), item]);
}

/** Take one off the queue (it got through some other way). */
export function dequeue(clientId: string) {
  const q = readQueue();
  if (q.some((x) => x.clientId === clientId)) writeQueue(q.filter((x) => x.clientId !== clientId));
}

/** Send everything waiting. Returns how many went through; items the server refuses are dropped with their reason. */
export async function flushQueue(): Promise<{ sent: number; failed: string[] }> {
  const q = readQueue();
  if (!q.length) return { sent: 0, failed: [] };
  let sent = 0;
  const failed: string[] = [];
  const keep: Queued[] = [];
  for (const item of q) {
    try {
      const r = item.kind === "many" ? await scanMany(item) : await kegAction(item);
      if ("error" in r) failed.push(`${item.label}: ${r.error}`);
      else sent++;
    } catch {
      keep.push(item); // still offline
    }
  }
  writeQueue(keep);
  return { sent, failed };
}

/** Run an action now; if the network is down, queue it. */
export async function sendOrQueue(input: KegActionForm & { label: string }): Promise<{ ok: true; queued: boolean; result?: Awaited<ReturnType<typeof kegAction>> } | { error: string }> {
  const item: Queued = { ...input, kind: "action", clientId: input.clientId ?? newClientId(), at: Date.now() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueue(item);
    return { ok: true, queued: true };
  }
  try {
    const { label: _label, kind: _kind, ...form } = item;
    void _label;
    void _kind;
    const r = await kegAction(form);
    if ("error" in r) return { error: r.error };
    return { ok: true, queued: false, result: r };
  } catch {
    enqueue(item);
    return { ok: true, queued: true };
  }
}
