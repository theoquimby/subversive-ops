"use server";

import { requireUser } from "@/server/auth";
import { setWholesalePrice } from "@/server/services/brewCogs";
import { revalidatePath } from "next/cache";

export async function setWholesaleAction(which: "half" | "sixth", raw: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  if (which !== "half" && which !== "sixth") return { error: "Reload the page and try again." };
  const t = String(raw).replace(/[$,\s]/g, "");
  if (t === "") {
    await setWholesalePrice(which, null);
  } else {
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 10_000) return { error: "A price, like 185" };
    await setWholesalePrice(which, n);
  }
  revalidatePath("/brewery/costs");
}
