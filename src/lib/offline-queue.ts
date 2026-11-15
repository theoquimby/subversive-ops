"use client";

/**
 * A small "send now, or keep it for when there's signal" queue for staff
 * actions (counts, waste), the same idea as the keg and prep queues: each
 * item carries an id made on the phone, waits in this phone's storage if the
 * request can't go out (the walk-in), and is retried when the connection
 * comes back. Servers apply an id once, so a retry never doubles anything.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

export interface QueueItem {
  clientId: string;
  /** Plain-English line for "waiting to send" and failure messages. */
  label: string;
}

type SendResult = { error?: string | null } | void | null | undefined | Record<string, unknown>;

export function newClientId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const errorOf = (r: SendResult): string | null => (r && typeof r === "object" && "error" in r && typeof r.error === "string" && r.error ? r.error : null);

export function createOfflineQueue<T extends QueueItem>(opts: {
  key: string;
  send: (item: T) => Promise<SendResult>;
  /** A newer item replaces an older unsent one when this says so (e.g. the same count line). */
  replaces?: (older: T, newer: T) => boolean;
}) {
  const event = `queue:${opts.key}`;

  function read(): T[] {
    try {
      const v = JSON.parse(localStorage.getItem(opts.key) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function write(q: T[]) {
    try {
      localStorage.setItem(opts.key, JSON.stringify(q));
    } catch {
      // Private mode or storage full: nothing to keep.
    }
    window.dispatchEvent(new Event(event));
  }

  function enqueue(item: T) {
    write([...read().filter((x) => x.clientId !== item.clientId && !opts.replaces?.(x, item)), item]);
  }

  let flushing: Promise<{ sent: number; failed: string[] }> | null = null;
  /** Send everything waiting. Items the server refuses are dropped with their reason. */
  function flush(): Promise<{ sent: number; failed: string[] }> {
    if (flushing) return flushing;
    flushing = (async () => {
      const q = read();
      let sent = 0;
      const failed: string[] = [];
      const keep: T[] = [];
      for (const item of q) {
        try {
          const err = errorOf(await opts.send(item));
          if (err) failed.push(`${item.label}: ${err}`);
          else sent++;
        } catch {
          keep.push(item); // still no signal
        }
      }
      // Anything queued while we were sending stays too.
      const sentIds = new Set(q.map((x) => x.clientId));
      write([...keep, ...read().filter((x) => !sentIds.has(x.clientId))]);
      return { sent, failed };
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  /** Send now; if there's no connection, keep it for later. */
  async function send(item: T): Promise<{ ok: true; queued: boolean } | { error: string }> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      enqueue(item);
      return { ok: true, queued: true };
    }
    try {
      const err = errorOf(await opts.send(item));
      return err ? { error: err } : { ok: true, queued: false };
    } catch {
      enqueue(item);
      return { ok: true, queued: true };
    }
  }

  /** Unsent items on this phone (live). Sends them when the connection comes back. */
  function useQueue(onFailed?: (failed: string[]) => void): T[] {
    const [items, setItems] = useState<T[]>([]);
    useEffect(() => {
      const update = () => setItems(read());
      const go = () => {
        if (!read().length) return;
        void flush().then((r) => {
          update();
          if (r.failed.length) onFailed?.(r.failed);
        });
      };
      update();
      go();
      window.addEventListener(event, update);
      window.addEventListener("online", go);
      const t = setInterval(() => navigator.onLine && go(), 20_000);
      return () => {
        window.removeEventListener(event, update);
        window.removeEventListener("online", go);
        clearInterval(t);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return items;
  }

  return { read, enqueue, flush, send, useQueue };
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** True while the browser says there's no connection. */
export const useOffline = () => useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);
