"use server";

import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { DOCUMENT_KINDS, DOCUMENT_TYPES, extractDocumentText, MAX_DOCUMENT_BYTES } from "@/server/services/documents";
import { revalidatePath } from "next/cache";

const refresh = () => { revalidatePath("/team/documents"); revalidatePath("/team"); revalidatePath("/my"); };

function guessMime(f: File) {
  if (f.type && f.type in DOCUMENT_TYPES) return f.type;
  const ext = f.name.toLowerCase().split(".").pop();
  return ({ pdf: "application/pdf", txt: "text/plain", md: "text/markdown", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as Record<string, string>)[ext ?? ""] ?? null;
}

export async function uploadDocument(_: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requireUser("MANAGER");
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "Choose a file to upload." };
  if (f.size > MAX_DOCUMENT_BYTES) return { error: `That file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 8 MB — try a smaller PDF.` };
  const mime = guessMime(f);
  if (!mime) return { error: "Upload a PDF, Word file, text file or photo." };
  const kind = String(form.get("kind") ?? "POLICY");
  const title = String(form.get("title") ?? "").trim().slice(0, 120) || f.name.replace(/\.[^.]+$/, "");
  const bytes = new Uint8Array(await f.arrayBuffer());
  const { text, via } = await extractDocumentText(bytes, mime);
  await db.document.create({
    data: {
      title,
      kind: DOCUMENT_KINDS.some((k) => k.value === kind) ? kind : "POLICY",
      bytes: Buffer.from(bytes),
      mime,
      size: f.size,
      filename: f.name.slice(0, 200),
      text,
      requiresAck: form.get("requiresAck") === "yes",
      audience: form.get("audience") === "MANAGER" ? "MANAGER" : "STAFF",
      uploadedBy: s.name,
    },
  });
  refresh();
  const note = via === "claude" ? " Text read by Claude for questions." : text ? "" : " No text could be read from it — paste the text below so the assistant can use it.";
  return { ok: `Uploaded “${title}”.${note}` };
}

type Field = "title" | "kind" | "audience" | "requiresAck" | "text";

export async function setDocumentField(id: string, field: Field, raw: string): Promise<{ error?: string } | void> {
  await requireUser("MANAGER");
  const v = raw.trim();
  let data: Record<string, unknown>;
  switch (field) {
    case "title":
      if (!v) return { error: "A document needs a title." };
      data = { title: v.slice(0, 120) };
      break;
    case "kind":
      if (!DOCUMENT_KINDS.some((k) => k.value === v)) return { error: "Pick a type." };
      data = { kind: v };
      break;
    case "audience":
      if (v !== "STAFF" && v !== "MANAGER") return { error: "Pick who sees it." };
      data = { audience: v, ...(v === "MANAGER" ? { requiresAck: false } : {}) };
      break;
    case "requiresAck":
      data = { requiresAck: v === "yes" };
      break;
    case "text":
      data = { text: v ? v.slice(0, 400_000) : null };
      break;
  }
  await db.document.update({ where: { id }, data }).catch(() => null);
  refresh();
}

export async function archiveDocument(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await db.document.update({ where: { id }, data: { active: false } }).catch(() => null);
  refresh();
  return {};
}
