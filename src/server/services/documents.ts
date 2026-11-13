import "server-only";
import { z } from "zod";
import { searchPolicies, type PolicyPassage } from "@/domain/policySearch";
import { tidyText } from "@/domain/pdfText";
import { pdfTextLocal } from "./pdf-text";
import { claudeConfigured, claudeJSON, pdfBlock } from "../integrations/claude";
import { db } from "../db";

/**
 * Onboarding and policy documents: stored as bytes in Postgres (8 MB cap),
 * with a plain-text copy used for search and the HR assistant.
 */

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export const DOCUMENT_KINDS = [
  { value: "HANDBOOK", label: "Handbook" },
  { value: "POLICY", label: "Policy" },
  { value: "TAX_FORM", label: "Tax form" },
  { value: "OTHER", label: "Other" },
] as const;

export const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Text",
  "image/jpeg": "Image",
  "image/png": "Image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
};

const extracted = z.object({ text: z.string().describe("All readable text of the document, in reading order, as plain text with blank lines between sections.") });

/**
 * Text for search and the assistant. Text files are read as-is; PDFs are read
 * locally, and by Claude when that finds nothing and a key is configured.
 */
export async function extractDocumentText(bytes: Uint8Array, mime: string): Promise<{ text: string | null; via: "plain" | "local" | "claude" | null }> {
  if (mime.startsWith("text/")) return { text: tidyText(Buffer.from(bytes).toString("utf8")).slice(0, 400_000), via: "plain" };
  if (mime !== "application/pdf") return { text: null, via: null };
  const local = pdfTextLocal(bytes);
  // Fewer than ~40 letters means a scan or an encoding we can't read.
  if ((local.match(/[A-Za-z]/g)?.length ?? 0) >= 40) return { text: local.slice(0, 400_000), via: "local" };
  if (!claudeConfigured()) return { text: null, via: null };
  const r = await claudeJSON({
    schema: extracted,
    system: "You transcribe documents. Copy the text exactly; do not summarize, add or leave out anything.",
    content: [pdfBlock(bytes), "Transcribe this document's text."],
    effort: "low",
    maxTokens: 16000,
  });
  return r.ok && r.data.text.trim() ? { text: tidyText(r.data.text), via: "claude" } : { text: null, via: null };
}

/** Documents a viewer may see: staff only see STAFF documents. */
export function documentScope(role: "MANAGER" | "STAFF") {
  return role === "MANAGER" ? { active: true } : { active: true, audience: "STAFF" as const };
}

export interface PolicyAnswer {
  mode: "claude" | "search";
  /** Claude's answer, only from the documents. Null when they don't cover it. */
  answer: string | null;
  citations: { docId: string; title: string; quote: string }[];
  /** Matching passages (search mode, or the evidence Claude was given). */
  passages: PolicyPassage[];
  error?: string;
  /** How many documents had readable text. */
  searched: number;
}

const answerSchema = z.object({
  covered: z.boolean().describe("True only if the excerpts directly answer the question."),
  answer: z.string().describe("Short plain-English answer drawn only from the excerpts. Empty if not covered."),
  citations: z.array(z.object({ title: z.string().describe("Exact document title"), quote: z.string().describe("Short exact quote from that document supporting the answer") })),
});

const SYSTEM = `You answer staff questions for a small brewery and restaurant using ONLY the policy excerpts provided.
Rules:
- Use only what the excerpts say. Never fill gaps from general knowledge, law, or what is "typical".
- If the excerpts don't directly answer the question, set covered=false, leave answer empty, and give no citations.
- Cite the document title exactly as given for every fact, with a short exact quote.
- Plain, calm English, 1–4 sentences. No legal advice.`;

/** Answer a policy question from uploaded documents only. */
export async function answerPolicyQuestion(question: string, role: "MANAGER" | "STAFF"): Promise<PolicyAnswer> {
  const docs = (await db.document.findMany({ where: { ...documentScope(role), text: { not: null } }, select: { id: true, title: true, text: true } }))
    .filter((d) => d.text && d.text.trim())
    .map((d) => ({ id: d.id, title: d.title, text: d.text! }));
  const passages = searchPolicies(docs, question, 8);
  const base = { searched: docs.length, passages: passages.slice(0, 4) };
  if (docs.length === 0) return { mode: "search", answer: null, citations: [], ...base };
  if (!claudeConfigured()) return { mode: "search", answer: null, citations: [], ...base };

  // Small libraries go in whole (better answers); big ones send the best passages.
  const total = docs.reduce((a, d) => a + d.text.length, 0);
  const excerpts = total <= 120_000 ? docs.map((d) => ({ title: d.title, text: d.text })) : passages.map((p) => ({ title: p.title, text: p.text }));
  if (excerpts.length === 0) return { mode: "claude", answer: null, citations: [], ...base };
  const r = await claudeJSON({
    schema: answerSchema,
    system: SYSTEM,
    effort: "low",
    maxTokens: 4000,
    content: [
      excerpts.map((e) => `<document title=${JSON.stringify(e.title)}>\n${e.text}\n</document>`).join("\n\n"),
      `Question: ${question}`,
    ],
  });
  if (!r.ok) return { mode: "search", answer: null, citations: [], ...base, error: r.error };
  // Keep only citations whose title is a real document and whose quote is really in it.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const byTitle = new Map(docs.map((d) => [norm(d.title), d]));
  const citations = r.data.citations
    .map((c) => ({ c, d: byTitle.get(norm(c.title)) }))
    .filter((x): x is { c: (typeof r.data.citations)[number]; d: (typeof docs)[number] } => !!x.d && norm(x.d.text).includes(norm(x.c.quote).slice(0, 60)))
    .map(({ c, d }) => ({ docId: d.id, title: d.title, quote: c.quote }));
  // An answer with no verifiable source isn't shown.
  if (!r.data.covered || !r.data.answer.trim() || citations.length === 0) return { mode: "claude", answer: null, citations: [], ...base };
  return { mode: "claude", answer: r.data.answer.trim(), citations, ...base };
}
