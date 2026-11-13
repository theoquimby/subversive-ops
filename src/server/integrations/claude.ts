import "server-only";

/**
 * Shared Claude (Anthropic API) client.
 *
 *   if (!claudeConfigured()) → show the manual path
 *   const r = await claudeJSON({ schema, system, content: [imageBlock(bytes, "image/jpeg"), "Read this."] });
 *   if (!r.ok) → r.error is a calm, user-facing sentence
 *
 * `schema` is a zod object; the response is constrained to it (structured
 * outputs) and parsed, so `r.data` is fully typed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const CLAUDE_MODEL = "claude-opus-5-5";

export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

let client: Anthropic | null = null;
export function claudeClient(): Anthropic {
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return client;
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
  if (!claudeConfigured()) return { ok: false, error: "Automatic reading turns on once the Claude API key is added." };
  try {
    const res = await claudeClient().beta.messages.parse({
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
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "The Claude API key was rejected. Check it in the environment settings." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Claude is busy right now. Try again in a minute." };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, error: `Claude couldn't take that file (${e.message.slice(0, 120)}).` };
    if (e instanceof Anthropic.APIError) return { ok: false, error: "Couldn't reach Claude just now. Try again shortly." };
    console.error("claudeJSON failed", e);
    return { ok: false, error: "Something went wrong reading that. Try again or enter it by hand." };
  }
}
