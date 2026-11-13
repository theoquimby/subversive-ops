import "server-only";

/**
 * Shared Claude (Anthropic API) client.
 *
 *   if (!(await claudeReady())) → show the manual path
 *   const r = await claudeJSON({ schema, system, content: [imageBlock(bytes, "image/jpeg"), "Read this."] });
 *   if (!r.ok) → r.error is a calm, user-facing sentence
 *
 * `schema` is a zod object; the response is constrained to it (structured
 * outputs) and parsed, so `r.data` is fully typed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { getSecret } from "../services/secrets";
import { NO_NETWORK } from "./network";

export const CLAUDE_MODEL = "claude-opus-5-5";

/** Whether a Claude key is saved (Settings → Connections) or set in the environment. */
export const claudeReady = async () => Boolean(await getSecret("ANTHROPIC_API_KEY"));

export const CLAUDE_NOT_SET_UP = "AI features turn on once a Claude key is added in Settings → Connections.";

let client: { key: string; client: Anthropic } | null = null;
/** A client for the current key (rebuilt when the key changes). Throws when no key is set. */
export async function claudeClient(): Promise<Anthropic> {
  const key = await getSecret("ANTHROPIC_API_KEY");
  if (!key) throw new Error(CLAUDE_NOT_SET_UP);
  if (client?.key !== key) client = { key, client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }) };
  return client.client;
}

/**
 * Connection check for Settings → Connections: looks up the model this app
 * uses (free, no tokens spent). Tests `key` when given, else the saved one.
 */
export async function testClaudeKey(key?: string): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const c = key ? new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }) : await claudeClient();
    const m = await c.models.retrieve(CLAUDE_MODEL);
    return { ok: true, model: m.display_name || CLAUDE_MODEL };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "Claude didn't accept that key. Copy it again from the Claude Console (API keys page) — it's only shown once, so you may need to create a new one." };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "That key works but isn't allowed to use Claude yet. In the Claude Console, check Billing has a payment method or credit." };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, error: "The key works, but this account can't use the model the app needs. Contact Anthropic support or try a key from another workspace." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Claude is busy right now. Try the test again in a minute." };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: NO_NETWORK("Claude") };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Claude answered with an error (${e.status ?? "unknown"}). Try again in a minute.` };
    if (e instanceof Error && e.message === CLAUDE_NOT_SET_UP) return { ok: false, error: "Paste a Claude key first." };
    return { ok: false, error: NO_NETWORK("Claude") };
  }
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
type Block = Anthropic.Beta.BetaContentBlockParam;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export const imageBlock = (bytes: Uint8Array, mediaType: ImageMediaType): Block => ({ type: "image", source: { type: "base64", media_type: mediaType, data: b64(bytes) } });

export const pdfBlock = (bytes: Uint8Array): Block => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } });

/** An image or PDF upload as a content block, or null for anything else. */
export function fileBlock(bytes: Uint8Array, mediaType: string): Block | null {
  if (mediaType === "application/pdf") return pdfBlock(bytes);
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) return imageBlock(bytes, mediaType as ImageMediaType);
  return null;
}

export type ClaudeResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One request, structured JSON back. Content items may be strings (text) or
 * blocks (images/PDFs — put them before the text that refers to them).
 */
export async function claudeJSON<S extends z.ZodType>(args: {
  schema: S;
  content: (string | Block)[];
  system?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<ClaudeResult<z.infer<S>>> {
  if (!(await claudeReady())) return { ok: false, error: CLAUDE_NOT_SET_UP };
  try {
    const res = await (await claudeClient()).beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: args.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: args.system,
      output_config: { format: betaZodOutputFormat(args.schema), effort: args.effort ?? "medium" },
      messages: [{ role: "user", content: args.content.map((c) => (typeof c === "string" ? { type: "text" as const, text: c } : c)) }],
    });
    if (res.stop_reason === "refusal") return { ok: false, error: "Claude couldn't read this one. Enter it by hand instead." };
    if (res.stop_reason === "max_tokens") return { ok: false, error: "That was too long to read in one go. Enter it by hand or split it up." };
    if (res.parsed_output == null) return { ok: false, error: "Claude's answer didn't come back in the expected shape. Try again or enter it by hand." };
    return { ok: true, data: res.parsed_output as z.infer<S> };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "Claude didn't accept the saved key. Replace it in Settings → Connections → AI features." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Claude is busy right now. Try again in a minute." };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, error: `Claude couldn't take that file (${e.message.slice(0, 120)}).` };
    if (e instanceof Anthropic.APIError) return { ok: false, error: "Couldn't reach Claude just now. Try again shortly." };
    console.error("claudeJSON failed", e);
    return { ok: false, error: "Something went wrong reading that. Try again or enter it by hand." };
  }
}
