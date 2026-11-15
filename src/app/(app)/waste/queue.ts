"use client";

/**
 * Waste logged on this phone while there's no signal, sent when it comes
 * back. Each entry's id becomes its batch id on the server, so a retry is
 * applied once.
 */

import { createOfflineQueue, type QueueItem } from "@/lib/offline-queue";
import { logWasteEntry, type WasteEntry } from "./actions";

export type QueuedWaste = QueueItem & WasteEntry & { clientId: string };

export const wasteQueue = createOfflineQueue<QueuedWaste>({
  key: "waste.queue.v1",
  send: ({ clientId, mode, itemId, qty, unit, reason }) => logWasteEntry({ clientId, mode, itemId, qty, unit, reason }),
});
