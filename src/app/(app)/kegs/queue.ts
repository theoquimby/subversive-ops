"use client";

/**
 * Offline-tolerant keg actions. Each action gets an id made on the phone; if
 * sending fails (walk-in with no signal), it waits in this phone's storage
 * and is retried when the connection comes back. The server applies an id
 * once, so a retry never doubles a kick.
 */

import { kegAction, type KegActionForm } from "./actions";

const KEY = "kegs.queue.v1";

export type Queued = KegActionForm & { clientId: string; at: number; label: string };

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

/** Send everything waiting. Returns how many went through; items the server refuses are dropped with their reason. */
export async function flushQueue(): Promise<{ sent: number; failed: string[] }> {
  const q = readQueue();
  if (!q.length) return { sent: 0, failed: [] };
  let sent = 0;
  const failed: string[] = [];
  const keep: Queued[] = [];
  for (const item of q) {
    try {
      const r = await kegAction(item);
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
  const item: Queued = { ...input, clientId: input.clientId ?? newClientId(), at: Date.now() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueue(item);
    return { ok: true, queued: true };
  }
  try {
    const { label: _label, ...form } = item;
    void _label;
    const r = await kegAction(form);
    if ("error" in r) return { error: r.error };
    return { ok: true, queued: false, result: r };
  } catch {
    enqueue(item);
    return { ok: true, queued: true };
  }
}
