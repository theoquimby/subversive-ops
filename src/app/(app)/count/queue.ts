"use client";

/**
 * Count lines saved on this phone when there's no signal (walk-in, basement)
 * and sent when it comes back. Saving a line is an upsert, so a retry is
 * harmless; a newer number for the same line replaces an unsent older one.
 */

import { createOfflineQueue, type QueueItem } from "@/lib/offline-queue";
import { saveCountLine } from "./actions";

export type QueuedCount = QueueItem & { countId: string; ingredientId: string; qty: number | null; unit: string; parts?: { qty: number; unit: string }[] | null; area?: string | null };

export const countQueue = createOfflineQueue<QueuedCount>({
  key: "count.queue.v1",
  send: (i) => saveCountLine(i.countId, i.ingredientId, i.qty, i.unit, i.parts, i.area),
  replaces: (a, b) => a.countId === b.countId && a.ingredientId === b.ingredientId && (a.area ?? null) === (b.area ?? null),
});
