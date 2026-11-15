"use server";

import { pingWebsite } from "@/server/services/website";
import { DIET_TAGS, moveLine, parseAbv, parseBoardPours, parseIbu, formatBoardPours } from "@/domain/taps";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { publicOrigin } from "@/server/services/public-url";
import { boardConfig, regenerateDisplayToken, saveBoardConfig, tapList } from "@/server/services/taps";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => {
  revalidatePath("/kegs", "layout");
  pingWebsite("menu");
};

// ---- Board order and coming soon ------------------------------------------------------------

/** Move a tap up or down on the board (and the website). */
export async function moveTap(line: number, dir: -1 | 1): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  if (!Number.isInteger(line) || (dir !== -1 && dir !== 1)) return { error: "Pick a tap." };
  // Only lines with a keg are on the board; move among those, free lines keep their place after.
  const { rows, free } = await tapList();
  await saveBoardConfig({ order: [...moveLine(rows.map((r) => r.line), line, dir), ...free] });
  refresh();
  return {};
}

/** Back to tap number order. */
export async function resetTapOrder(): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await saveBoardConfig({ order: [] });
  refresh();
  return {};
}

export async function setComingSoon(beerId: string, value: "auto" | "yes" | "no"): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  if (!["auto", "yes", "no"].includes(value)) return { error: "Pick one." };
  await db.beer.update({ where: { id: beerId }, data: { comingSoon: value === "auto" ? null : value === "yes" } });
  refresh();
  return {};
}

export async function setAutoComingSoon(on: boolean): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await saveBoardConfig({ autoComingSoon: !!on });
  refresh();
  return {};
}

export async function setBoardTitle(raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const t = String(raw ?? "").trim().slice(0, 40);
  if (!t) return { error: "Name the board." };
  await saveBoardConfig({ title: t });
  refresh();
  return {};
}

/** A new TV link. The old one stops working within a minute (the board says so). */
export async function newBoardLink(): Promise<{ url: string } | { error: string }> {
  await requireUser("MANAGER");
  const token = await regenerateDisplayToken();
  refresh();
  return { url: `${await publicOrigin()}/display/taps/${token}` };
}

export async function boardSettings() {
  await requireUser("MANAGER");
  return boardConfig();
}

// ---- Beer details for the board ------------------------------------------------------------

const fieldSchema = z.enum(["abv", "ibu", "description", "diet", "boardPours", "comingSoon"]);
export type BeerBoardField = z.infer<typeof fieldSchema>;

export async function setBeerBoardField(id: string, field: BeerBoardField, raw: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const f = fieldSchema.safeParse(field);
  if (!f.success || typeof id !== "string" || !id) return { error: "That doesn't look right." };
  const value = String(raw ?? "").trim();
  let data: Prisma.BeerUpdateInput;
  switch (f.data) {
    case "abv": { const v = parseAbv(value); if (v && typeof v === "object") return v; data = { abv: v }; break; }
    case "ibu": { const v = parseIbu(value); if (v && typeof v === "object") return v; data = { ibu: v }; break; }
    case "description": if (value.length > 140) return { error: "Keep it under 140 characters so it fits the board" }; data = { description: value || null }; break;
    case "diet": if (value && !(DIET_TAGS as readonly string[]).includes(value)) return { error: "Pick one" }; data = { diet: value || null }; break;
    case "boardPours": {
      if (!value) { data = { boardPours: null }; break; }
      const p = parseBoardPours(value);
      if ("error" in p) return p;
      data = { boardPours: formatBoardPours(p) };
      break;
    }
    case "comingSoon": if (!["auto", "yes", "no"].includes(value)) return { error: "Pick one" }; data = { comingSoon: value === "auto" ? null : value === "yes" }; break;
  }
  await db.beer.update({ where: { id }, data });
  refresh();
  return {};
}

const LABEL_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LABEL_MAX = 300 * 1024;

/** A small label image (the browser shrinks it to 320 px first). */
export async function uploadBeerLabel(form: FormData): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  const id = String(form.get("beerId") ?? "");
  const file = form.get("file");
  if (!id || !(file instanceof File)) return { error: "Pick an image." };
  if (!LABEL_TYPES.includes(file.type)) return { error: "Use a PNG, JPEG or WebP image." };
  if (file.size > LABEL_MAX) return { error: "That image is too big. Under 300 KB, please." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Check the file really is the image type it says (magic bytes).
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(png && file.type === "image/png") && !(jpg && file.type === "image/jpeg") && !(webp && file.type === "image/webp")) return { error: "That file isn't a readable image." };
  if (!(await db.beer.findUnique({ where: { id }, select: { id: true } }))) return { error: "That beer was removed." };
  await db.$transaction([
    db.beerLabel.upsert({ where: { beerId: id }, create: { beerId: id, mime: file.type, bytes }, update: { mime: file.type, bytes } }),
    db.beer.update({ where: { id }, data: { labelAt: new Date() } }),
  ]);
  refresh();
  return {};
}

export async function removeBeerLabel(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.beerLabel.deleteMany({ where: { beerId: id } });
  await db.beer.update({ where: { id }, data: { labelAt: null } }).catch(() => undefined);
  refresh();
  return {};
}
