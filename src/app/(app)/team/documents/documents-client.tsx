"use client";

import { useConfirm } from "@/components/dialog";
import { FileDrop, type FileDropHandle } from "@/components/file-drop";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { Archive, ExternalLink, FileText } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";
import { archiveDocument, setDocumentField, uploadDocument } from "./actions";

const KINDS = [
  { value: "HANDBOOK", label: "Handbook" },
  { value: "POLICY", label: "Policy" },
  { value: "TAX_FORM", label: "Tax form" },
  { value: "OTHER", label: "Other" },
];
const AUDIENCE = [{ value: "STAFF", label: "Everyone" }, { value: "MANAGER", label: "Managers" }];
const YES_NO = [{ value: "yes", label: "Required" }, { value: "no", label: "Optional" }];

export function UploadDocument() {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  const drop = useRef<FileDropHandle>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  return (
    <Card className="p-5" data-tour="documents.upload">
      <form
        action={(fd) => {
          if (file) fd.set("file", file);
          action(fd);
        }}
        className="space-y-4"
        key={state?.ok}
      >
        <FileDrop ref={drop} accept=".pdf,.docx,.txt,.md,image/jpeg,image/png,application/pdf,text/plain" hint="PDF, Word, text or a photo · up to 8 MB" onFile={(f) => { setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); }} />
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="Title">
            <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Staff handbook 2026" />
          </Field>
          <Field label="Type">
            <Select name="kind" defaultValue="POLICY" options={KINDS} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who sees it">
            <Select name="audience" defaultValue="STAFF" options={AUDIENCE} />
          </Field>
          <Field label="Staff must acknowledge">
            <Select name="requiresAck" defaultValue="no" options={[{ value: "yes", label: "Yes — show on My shifts until signed" }, { value: "no", label: "No — just available" }]} />
          </Field>
        </div>
        <div aria-live="polite" className="text-sm">
          {state?.error && <p className="text-bad">{state.error}</p>}
          {state?.ok && <p className="text-good">{state.ok}</p>}
        </div>
        <Button variant="primary" disabled={pending || !file} className="w-full sm:w-auto">{pending ? "Uploading…" : "Upload"}</Button>
      </form>
    </Card>
  );
}

export interface DocRow {
  id: string;
  title: string;
  kind: string;
  mime: string;
  size: number;
  requiresAck: boolean;
  audience: string;
  uploadedBy: string | null;
  createdAt: string;
  text: string;
  hasText: boolean;
  acks: number;
}

const td = "border-b border-border px-2 py-1 align-middle [tr:last-child_&]:border-b-0";

export function DocumentGrid({ docs, staff }: { docs: DocRow[]; staff: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted">Document</th>
            <th className="hidden w-32 border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted md:table-cell">Type</th>
            <th className="hidden w-32 border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted sm:table-cell">Who sees it</th>
            <th className="hidden w-32 border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted lg:table-cell">Sign-off</th>
            <th className="hidden w-24 border-b border-border px-4 py-2.5 text-right text-[0.75rem] font-medium text-muted sm:table-cell">Signed</th>
            <th className="w-24 border-b border-border" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <DocRowView key={d.id} d={d} staff={staff} open={open === d.id} toggle={() => setOpen(open === d.id ? null : d.id)} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function DocRowView({ d, staff, open, toggle }: { d: DocRow; staff: number; open: boolean; toggle: () => void }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      <tr className="transition-colors hover:bg-surface-2/60">
        <td className={td}>
          <div className="flex items-start gap-2 pl-2">
            <FileText className="mt-2.5 hidden size-4 shrink-0 text-muted sm:block" />
            <div className="min-w-[11rem] flex-1">
              <GridCell grid="docs" col="title" value={d.title} onSave={setDocumentField.bind(null, d.id, "title")} ariaLabel="Document title" className="font-medium" />
              <div className="px-2 pb-1 text-xs text-muted">
                {d.size < 1024 ? "<1" : (d.size / 1024).toFixed(0)} KB · {shortDate(d.createdAt.slice(0, 10))}{d.uploadedBy ? ` · ${d.uploadedBy}` : ""}
                {!d.hasText && <> · <span className="text-warn">no text for questions</span></>}
                {d.requiresAck && d.audience === "STAFF" && <span className="sm:hidden"> · <span className={d.acks >= staff ? "text-good" : "text-warn"}>{d.acks}/{staff} signed</span></span>}
              </div>
            </div>
          </div>
        </td>
        <td className={cx(td, "hidden md:table-cell")}><GridSelect value={d.kind} options={KINDS} onSave={setDocumentField.bind(null, d.id, "kind")} ariaLabel={`${d.title} type`} /></td>
        <td className={cx(td, "hidden sm:table-cell")}><GridSelect value={d.audience} options={AUDIENCE} onSave={setDocumentField.bind(null, d.id, "audience")} ariaLabel={`${d.title} audience`} /></td>
        <td className={cx(td, "hidden lg:table-cell")}>
          {d.audience === "STAFF" ? <GridSelect value={d.requiresAck ? "yes" : "no"} options={YES_NO} onSave={setDocumentField.bind(null, d.id, "requiresAck")} ariaLabel={`${d.title} sign-off`} /> : <span className="px-2 text-muted">—</span>}
        </td>
        <td className={cx(td, "num hidden px-4 text-right sm:table-cell")}>
          {d.requiresAck && d.audience === "STAFF" ? <Badge tone={d.acks >= staff ? "good" : "warn"}>{d.acks}/{staff}</Badge> : <span className="text-muted">—</span>}
        </td>
        <td className={cx(td, "text-right whitespace-nowrap")}>
          <a href={`/my/documents/${d.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${d.title}`} className="inline-grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8"><ExternalLink className="size-4" /></a>
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={`${d.title} settings and text`} className={cx("inline-grid size-10 place-items-center rounded-md text-xs hover:bg-surface-2 sm:size-8", open ? "bg-surface-2 text-ink" : "text-muted")}>•••</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="border-b border-border bg-surface-2/40 px-3 py-3 sm:px-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
              <span className="inline-flex items-center gap-2 md:hidden">Type <span className="w-32"><GridSelect value={d.kind} options={KINDS} onSave={setDocumentField.bind(null, d.id, "kind")} ariaLabel={`${d.title} type`} /></span></span>
              <span className="inline-flex items-center gap-2 sm:hidden">Who sees it <span className="w-32"><GridSelect value={d.audience} options={AUDIENCE} onSave={setDocumentField.bind(null, d.id, "audience")} ariaLabel={`${d.title} audience`} /></span></span>
              {d.audience === "STAFF" && <span className="inline-flex items-center gap-2 lg:hidden">Sign-off <span className="w-32"><GridSelect value={d.requiresAck ? "yes" : "no"} options={YES_NO} onSave={setDocumentField.bind(null, d.id, "requiresAck")} ariaLabel={`${d.title} sign-off`} /></span></span>}
              <Button
                size="sm"
                variant="danger"
                className="ml-auto h-10 sm:h-8"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirm({ title: `Archive ${d.title}?`, body: "Staff stop seeing it and the assistant stops using it. Sign-offs are kept.", confirmLabel: "Archive", danger: true }))) return;
                  start(async () => { await archiveDocument(d.id); });
                }}
              >
                <Archive className="size-3.5" /> Archive
              </Button>
            </div>
            <TextEditor id={d.id} initial={d.text} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The text the assistant and search read. Saves when you leave the box. */
function TextEditor({ id, initial }: { id: string; initial: string }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const last = useRef(initial);
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[0.8rem] font-medium text-ink-2">
        Text used to answer questions
        <span className="text-xs font-normal text-muted" aria-live="polite">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : `${v.length.toLocaleString()} characters`}</span>
      </span>
      <Textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={async () => {
          if (v === last.current) return;
          setSaved("saving");
          await setDocumentField(id, "text", v);
          last.current = v;
          setSaved("saved");
        }}
        rows={8}
        placeholder="Read from the file on upload. If it's a scan or a Word file, paste the text here so questions can be answered from it."
        className="font-mono text-xs leading-relaxed sm:text-xs"
      />
    </label>
  );
}

export function AckMatrix({ docs, people }: { docs: { id: string; title: string }[]; people: { id: string; name: string; acks: { docId: string; ackedAt: string | null }[] }[] }) {
  if (docs.length === 0) return <Card className="p-5 text-sm text-muted">No documents need signing. Set “Sign-off” to Required on any document staff should acknowledge.</Card>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 border-b border-border bg-surface px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted">Person</th>
            {docs.map((d) => <th key={d.id} className="border-b border-border px-3 py-2.5 text-left text-[0.75rem] font-medium whitespace-nowrap text-muted">{d.title}</th>)}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className="hover:bg-surface-2/60">
              <td className="sticky left-0 border-b border-border bg-surface px-4 py-2.5 font-medium [tr:last-child_&]:border-b-0">{p.name}</td>
              {docs.map((d) => {
                const at = p.acks.find((a) => a.docId === d.id)?.ackedAt;
                return <td key={d.id} className="border-b border-border px-3 py-2.5 whitespace-nowrap [tr:last-child_&]:border-b-0">{at ? <span className="text-good">✓ {shortDate(at.slice(0, 10))}</span> : <span className="text-warn">Not yet</span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
