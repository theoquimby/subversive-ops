import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfflineQueue, isNetworkError, type QueueItem } from "../offline-queue";

class UnrecognizedActionError extends Error {
  name = "UnrecognizedActionError";
}

let online = true;
beforeEach(() => {
  online = true;
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { get onLine() { return online; } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item: QueueItem = { clientId: "abcdef12-0001", label: "2 lb onions" };
const queueWith = (send: () => Promise<unknown>) => createOfflineQueue<QueueItem>({ key: "test.queue", send: send as never });

describe("offline queue send()", () => {
  it("sends straight away when the server takes it", async () => {
    const q = queueWith(async () => ({ ok: "Logged" }));
    expect(await q.send(item)).toEqual({ ok: true, queued: false });
    expect(q.read()).toEqual([]);
  });

  it("keeps it on the phone when the browser is offline", async () => {
    online = false;
    const send = vi.fn();
    const q = queueWith(send);
    expect(await q.send(item)).toEqual({ ok: true, queued: true });
    expect(send).not.toHaveBeenCalled();
    expect(q.read()).toEqual([item]);
  });

  it("keeps it on the phone when the request fails at the network", async () => {
    const q = queueWith(async () => { throw new TypeError("Failed to fetch"); });
    expect(await q.send(item)).toEqual({ ok: true, queued: true });
    expect(q.read()).toEqual([item]);
  });

  it("reports a server error instead of pretending it was saved", async () => {
    const q = queueWith(async () => { throw new Error("An error occurred in the Server Components render."); });
    const r = await q.send(item);
    expect(r).toHaveProperty("error");
    expect(q.read()).toEqual([]);
  });

  it("tells staff to reload when the page is older than the deployed app", async () => {
    const q = queueWith(async () => { throw new UnrecognizedActionError('Server Action "x" was not found on the server.'); });
    const r = await q.send(item);
    expect("error" in r && r.error).toMatch(/reload/i);
    expect(q.read()).toEqual([]);
  });

  it("passes the server's own refusal through", async () => {
    const q = queueWith(async () => ({ error: "Pick a unit." }));
    expect(await q.send(item)).toEqual({ error: "Pick a unit." });
  });
});

describe("offline queue flush()", () => {
  it("keeps an item that still can't send and reports a non-network failure once", async () => {
    const q = queueWith(async () => { throw new UnrecognizedActionError("not found"); });
    q.enqueue(item);
    const first = await q.flush();
    expect(first.failed).toHaveLength(1);
    expect(q.read()).toEqual([item]);
    const second = await q.flush();
    expect(second.failed).toEqual([]);
    expect(q.read()).toEqual([item]);
  });

  it("keeps an item silently while there's no signal", async () => {
    const q = queueWith(async () => { throw new TypeError("Load failed"); });
    q.enqueue(item);
    expect((await q.flush()).failed).toEqual([]);
    expect(q.read()).toEqual([item]);
  });
});

describe("isNetworkError", () => {
  it("only counts fetch failures", () => {
    expect(isNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(false);
  });
});
