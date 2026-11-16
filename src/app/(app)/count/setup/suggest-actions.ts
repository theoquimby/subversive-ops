"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const changes = z.array(z.object({ key: z.string().min(1).max(64), every: z.enum(["changes", "monthly"]) })).min(1).max(1000);

/** Apply the suggested "how often" for the items the manager kept ticked (Set up the count). */
export async function applyCountEvery(list: { key: string; every: "changes" | "monthly" }[]): Promise<{ error?: string; message?: string }> {
  await requireUser("MANAGER");
  const p = changes.safeParse(list);
  if (!p.success) return { error: "Tick at least one item." };
  const ops = (["changes", "monthly"] as const).map((every) =>
    db.ingredient.updateMany({ where: { id: { in: p.data.filter((x) => x.every === every).map((x) => x.key) }, countEvery: "every" }, data: { countEvery: every } }),
  );
  const done = (await db.$transaction(ops)).reduce((n, r) => n + r.count, 0);
  revalidatePath("/count", "layout");
  return { message: `Updated ${done} ${done === 1 ? "item" : "items"}. Counts get shorter from the next one.` };
}
