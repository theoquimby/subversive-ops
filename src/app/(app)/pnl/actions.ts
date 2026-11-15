"use server";

import { DISCOUNT_CLASSES, type DiscountClass } from "@/domain/squareMoney";
import { requireUser } from "@/server/auth";
import { setDiscountClass } from "@/server/services/square-money";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const input = z.object({
  name: z.string().trim().min(1, "Pick a discount").max(255),
  cls: z.enum(["default", ...DISCOUNT_CLASSES.map((c) => c.value)] as [string, ...string[]]),
});

/** Settings → Money: what one Square discount name counts as ("default" = from its name). */
export async function saveDiscountClass(name: string, cls: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const p = input.safeParse({ name, cls });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "That isn't a choice." };
  await setDiscountClass(p.data.name, p.data.cls === "default" ? null : (p.data.cls as DiscountClass));
  revalidatePath("/settings/money");
  revalidatePath("/pnl");
  return {};
}
