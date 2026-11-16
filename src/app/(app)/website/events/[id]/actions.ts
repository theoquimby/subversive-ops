"use server";

import { checkEventPage, EVENT_PAGE_LIMITS } from "@/domain/websiteEventPage";
import { requireUser } from "@/server/auth";
import { pingWebsite } from "@/server/services/website";
import { removeEventHero, saveEventPageContent, setEventHero } from "@/server/services/websiteEventPages";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = { error?: string; errors?: string[] };

const pair = <A extends string, B extends string>(a: A, b: B) => z.object({ [a]: z.string().max(10_000), [b]: z.string().max(10_000) } as Record<A | B, z.ZodString>);
const inputSchema = z.object({
  intro: z.string().max(10_000),
  heroAlt: z.string().max(2_000),
  sections: z.array(pair("title", "body")).max(50),
  schedule: z.array(pair("time", "what")).max(100),
  links: z.array(pair("label", "href")).max(50),
});
export type EventPageForm = z.infer<typeof inputSchema>;

const done = (eventId: string): R => {
  revalidatePath("/website/events");
  revalidatePath(`/website/events/${eventId}`);
  pingWebsite("events");
  return {};
};

export async function saveEventPage(eventId: string, raw: EventPageForm): Promise<R> {
  await requireUser("MANAGER");
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { error: "Something in the form didn't come through. Try again." };
  const r = checkEventPage(parsed.data);
  const alt = parsed.data.heroAlt.replace(/\s+/g, " ").trim();
  const errors = r.ok ? [] : [...r.errors];
  if (alt.length > EVENT_PAGE_LIMITS.heroAlt) errors.unshift(`Photo description: keep it to ${EVENT_PAGE_LIMITS.heroAlt} characters.`);
  if (!r.ok || errors.length) return { errors };
  if (!(await saveEventPageContent(String(eventId), r.value, alt || null))) return { error: "That event isn't on the website." };
  return done(String(eventId));
}

export async function uploadEventHero(form: FormData): Promise<R> {
  await requireUser("MANAGER");
  const eventId = String(form.get("eventId") ?? "");
  const file = form.get("file");
  if (!eventId || !(file instanceof File)) return { error: "Pick a photo." };
  const r = await setEventHero(eventId, file);
  if ("error" in r) return { error: r.error };
  return done(eventId);
}

export async function deleteEventHero(eventId: string): Promise<R> {
  await requireUser("MANAGER");
  await removeEventHero(String(eventId));
  return done(String(eventId));
}
