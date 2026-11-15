"use client";

/**
 * Offline-tolerant prep actions (ticks and on-hand counts), the same way keg
 * scans work: each action gets an id made on the phone; if sending fails (no
 * signal in the walk-in) it waits in this phone's storage and is retried when
 * the connection comes back. The server applies an id once.
 */

import { useEffect, useState } from "react";
import { prepAction, type PrepActionForm } from "./actions";

const KEY = "prep.queue.v1";
const EVENT = "prep-queue";

export type QueuedPrep = PrepActionForm & { clientId: string; label: string };

export function newClientId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function readPrepQueue(): QueuedPrep[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedPrep[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // Private mode or storage full: nothing to keep.
  }
  window.dispatchEvent(new Event(EVENT));
}

function enqueue(item: QueuedPrep) {
  // A newer action on the same line replaces an older unsent one (tick then untick = untick).
  writeQueue([...readPrepQueue().filter((x) => x.clientId !== item.clientId && !(x.recipeId === item.recipeId && x.kind !== "count" && item.kind !== "count")), item]);
}

export async function flushPrepQueue(): Promise<{ sent: number; failed: string[] }> {
  const q = readPrepQueue();
  if (!q.length) return { sent: 0, failed: [] };
  let sent = 0;
  const failed: string[] = [];
  const keep: QueuedPrep[] = [];
  for (const item of q) {
    try {
      const { label, ...form } = item;
      const r = await prepAction(form);
      if ("error" in r) failed.push(`${label}: ${r.error}`);
      else sent++;
    } catch {
      keep.push(item);
    }
  }
  writeQueue(keep);
  return { sent, failed };
}

/** Send now; if the network is down, keep it for later. */
export async function sendPrep(input: PrepActionForm & { label: string }): Promise<{ ok: true; queued: boolean } | { error: string }> {
  const item = { ...input, clientId: input.clientId ?? newClientId() } as QueuedPrep;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueue(item);
    return { ok: true, queued: true };
  }
  try {
    const { label, ...form } = item;
    void label;
    const r = await prepAction(form);
    if ("error" in r) return { error: r.error };
    return { ok: true, queued: false };
  } catch {
    enqueue(item);
    return { ok: true, queued: true };
  }
}

/** Unsent actions on this phone; sends them when the connection comes back. */
export function usePrepQueue() {
  const [items, setItems] = useState<QueuedPrep[]>([]);
  useEffect(() => {
    const update = () => setItems(readPrepQueue());
    const flush = () => { void flushPrepQueue().then(update); };
    update();
    flush();
    window.addEventListener(EVENT, update);
    window.addEventListener("online", flush);
    const t = setInterval(() => readPrepQueue().length && navigator.onLine && flush(), 20_000);
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener("online", flush); clearInterval(t); };
  }, []);
  return items;
}
