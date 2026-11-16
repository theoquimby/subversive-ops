"use client";

import { Check, ClipboardCopy, ImageIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { DataTable, downloadText, type Column, type Filter } from "@/components/data-table";
import { HelpTip } from "@/components/help";
import { Badge, Button, EmptyState, Select, Textarea } from "@/components/ui";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, feedbackKindLabel, feedbackStatusLabel, feedbackStatusTone, OPEN_STATUSES, roleLabel } from "@/domain/feedback";
import { feedbackDigest, type DigestNote } from "@/domain/feedbackDigest";
import { businessDateTime } from "@/lib/format";
import type { InboxFeedback } from "@/server/services/feedback";
import { saveFeedback, setStatusFor } from "./actions";

export interface InboxRow extends InboxFeedback {
  /** The part of the app it was sent from, e.g. "Kegs & taps". */
  area: string;
}

const who = (r: InboxRow) => r.userName?.trim() || "Someone";

const toDigest = (r: InboxRow): DigestNote => ({ kind: r.kind, userName: r.userName, role: r.role, date: r.date, path: r.path, pageTitle: r.pageTitle, body: r.body, status: r.status, note: r.note, hasPhoto: r.hasPhoto, device: r.device, appVersion: r.appVersion });

/** Copy text; falls back to the old way for browsers without clipboard access. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Copies notes as a Markdown digest for Claude; downloads it as a file if the browser won't copy. */
async function copyForClaude(rows: InboxRow[]): Promise<string> {
  const text = feedbackDigest(rows.map(toDigest));
  const n = `${rows.length} note${rows.length === 1 ? "" : "s"}`;
  if (await copyText(text)) return `Copied ${n} for Claude. Paste it into a Claude Code session.`;
  downloadText(`feedback-for-claude-${new Date().toISOString().slice(0, 10)}.md`, text, "text/markdown;charset=utf-8");
  return `This browser wouldn't copy, so the ${n} downloaded as a file instead.`;
}

export function FeedbackInbox({ rows }: { rows: InboxRow[] }) {
  // The rows the table shows right now (its filters and search), for "Copy for Claude".
  const shown = useRef<InboxRow[]>(rows);
  const [copied, setCopied] = useState<string | null>(null);

  const columns = useMemo<Column<InboxRow>[]>(() => [
    { id: "when", header: "When", width: 120, firstDir: "desc", sort: (r) => r.at, csv: (r) => businessDateTime(r.at), cell: (r) => <span className="num whitespace-nowrap text-ink-2">{businessDateTime(r.at)}</span> },
    { id: "who", header: "Who", sort: (r) => who(r), csv: (r) => who(r), cell: (r) => <span className="font-medium text-ink">{who(r)}</span> },
    { id: "role", header: "Role", sort: (r) => roleLabel(r.role), csv: (r) => roleLabel(r.role), cell: (r) => <span className="text-ink-2">{roleLabel(r.role) || "—"}</span> },
    { id: "kind", header: "Kind", sort: (r) => feedbackKindLabel(r.kind), csv: (r) => feedbackKindLabel(r.kind), cell: (r) => <Badge>{feedbackKindLabel(r.kind)}</Badge> },
    {
      id: "body",
      header: "Note",
      width: 360,
      sort: (r) => r.body,
      csv: (r) => r.body,
      cell: (r) => (
        <span className="block min-w-64 whitespace-normal">
          <span className="line-clamp-3 whitespace-pre-line text-ink">{r.body}</span>
          {r.hasPhoto && <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted"><ImageIcon className="size-3" aria-hidden /> Photo</span>}
        </span>
      ),
    },
    {
      id: "page",
      header: "Page",
      sort: (r) => r.pageTitle || r.path,
      csv: (r) => r.path,
      cell: (r) => (r.path ? <Link href={r.path} className="block max-w-56 truncate text-ink-2 hover:text-ink hover:underline" title={r.path}>{r.pageTitle || r.path}</Link> : <span className="text-muted">—</span>),
    },
    { id: "status", header: "Status", sort: (r) => FEEDBACK_STATUSES.findIndex((s) => s.value === r.status), csv: (r) => feedbackStatusLabel(r.status), cell: (r) => <Badge tone={feedbackStatusTone(r.status)}>{feedbackStatusLabel(r.status)}</Badge> },
    { id: "reply", header: "Reply", width: 220, sort: (r) => r.note, csv: (r) => r.note, cell: (r) => (r.note ? <span className="line-clamp-2 block min-w-40 whitespace-normal text-ink-2">{r.note}</span> : <span className="text-muted">—</span>) },
    { id: "device", header: "Device", defaultHidden: true, sort: (r) => r.device, csv: (r) => r.device, cell: (r) => <span className="text-ink-2">{r.device ?? "—"}</span> },
    { id: "version", header: "Version", defaultHidden: true, sort: (r) => r.appVersion, csv: (r) => r.appVersion, cell: (r) => <span className="num text-ink-2">{r.appVersion ?? "—"}</span> },
  ], []);

  const filters = useMemo<Filter<InboxRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", values: (r) => r.status, options: FEEDBACK_STATUSES, param: "status" },
    { id: "kind", label: "Kind", kind: "facet", values: (r) => r.kind, options: FEEDBACK_KINDS, param: "kind" },
    { id: "who", label: "Who", kind: "facet", values: (r) => who(r) },
    { id: "area", label: "Page area", kind: "facet", values: (r) => r.area },
    { id: "photo", label: "With a photo", kind: "toggle", test: (r) => r.hasPhoto },
  ], []);

  const copyShown = async () => setCopied(await copyForClaude(shown.current));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="primary" className="h-11 sm:h-9" onClick={copyShown} disabled={!rows.length}>
          <ClipboardCopy className="size-4" /> Copy for Claude
        </Button>
        <span className="text-sm text-muted">
          The notes shown below, as one tidy list to paste into Claude. Tick some to copy just those. <HelpTip id="settings.feedback.copy" />
        </span>
        {copied && <span role="status" className="w-full text-sm text-good">{copied}</span>}
      </div>
      <DataTable
        id="feedback"
        help="settings.feedback.inbox"
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        noun={["note", "notes"]}
        searchText={(r) => `${who(r)} ${r.body} ${r.note ?? ""} ${r.pageTitle ?? ""} ${r.path ?? ""} ${feedbackKindLabel(r.kind)} ${r.area}`}
        searchPlaceholder="Search feedback"
        filters={filters}
        defaultView={{ sort: [{ id: "when", dir: "desc" }], filters: { status: OPEN_STATUSES } }}
        csvName="feedback"
        drawerTitle={(r) => <>{feedbackKindLabel(r.kind)} from {who(r)}</>}
        drawer={(r) => <Detail key={r.id} row={r} />}
        summary={(visible) => {
          shown.current = visible;
          const count = (s: string) => visible.filter((r) => r.status === s).length;
          return [
            { value: visible.length, label: visible.length === 1 ? "note" : "notes" },
            { value: count("new"), label: "new", filter: { id: "status", value: "new" } },
            { value: count("planned"), label: "planned", tone: "warn", filter: { id: "status", value: "planned" } },
          ];
        }}
        card={(r) => ({
          title: r.body.split("\n")[0],
          subtitle: <>{feedbackKindLabel(r.kind)} · {who(r)} · {businessDateTime(r.at)}{r.pageTitle ? ` · ${r.pageTitle}` : ""}</>,
          value: <Badge tone={feedbackStatusTone(r.status)}>{feedbackStatusLabel(r.status)}</Badge>,
        })}
        empty={<EmptyState title="No feedback yet">When anyone taps Feedback (beside Help, on every page) and sends a note, it lands here with the page it came from.</EmptyState>}
        bulkActions={(api) => (
          <>
            <Select
              value=""
              placeholder="Set status"
              aria-label="Set status for the selected notes"
              options={FEEDBACK_STATUSES}
              onChange={(e) => e.target.value && api.run(() => setStatusFor(api.keys, e.target.value))}
              className="!h-8 !w-36"
              disabled={api.pending}
            />
            <Button size="sm" variant="ghost" onClick={async () => setCopied(await copyForClaude(api.rows))}><ClipboardCopy className="size-3.5" />Copy for Claude</Button>
          </>
        )}
      />
    </>
  );
}

/** The side panel: everything about one note, its status and the reply its sender sees. */
function Detail({ row }: { row: InboxRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = (patch: { status?: string; note?: string | null }, done: string) =>
    start(async () => {
      setError(null);
      setSaved(null);
      const r = await saveFeedback(row.id, patch);
      if (r.error) setError(r.error);
      else {
        setSaved(done);
        router.refresh();
      }
    });

  const dirty = note.trim() !== (row.note ?? "").trim();
  return (
    <div className="space-y-5">
      <section>
        <p className="text-[0.95rem] whitespace-pre-line text-ink">{row.body}</p>
        {row.hasPhoto && (
          <a href={`/settings/feedback/photo/${row.id}`} target="_blank" rel="noreferrer" className="mt-3 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/settings/feedback/photo/${row.id}`} alt="Photo sent with this note" className="max-h-80 w-full rounded-xl bg-surface-2 object-contain ring-1 ring-border" />
          </a>
        )}
      </section>

      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted">From</dt>
        <dd className="text-ink">{who(row)}{row.role ? <span className="text-muted"> · {roleLabel(row.role)}</span> : null}</dd>
        <dt className="text-muted">Sent</dt>
        <dd className="num text-ink">{businessDateTime(row.at)}</dd>
        <dt className="text-muted">Page</dt>
        <dd className="min-w-0 text-ink">{row.path ? <Link href={row.path} className="break-words underline decoration-border-strong underline-offset-2 hover:decoration-ink">{row.pageTitle || row.path}</Link> : "Not recorded"}{row.pageTitle && row.path && <span className="block truncate text-xs text-muted">{row.path}</span>}</dd>
        <dt className="text-muted">Device</dt>
        <dd className="text-ink">{row.device ?? "—"}{row.appVersion && <span className="text-muted"> · app {row.appVersion}</span>}</dd>
      </dl>

      <section className="space-y-3 border-t border-border pt-4">
        <label className="block">
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Status</span>
          <Select value={row.status} options={FEEDBACK_STATUSES} onChange={(e) => e.target.value !== row.status && save({ status: e.target.value }, "Status saved.")} disabled={pending} aria-label="Status" className="!w-44" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Reply or plan</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Good catch — fixing it this week." className="min-h-24 text-base sm:text-sm" maxLength={2000} />
          <span className="mt-1 block text-xs text-muted">{who(row)} sees this beside their note.</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" className="h-10 sm:h-8" disabled={pending || !dirty} onClick={() => save({ note: note.trim() || null }, "Reply saved.")}>Save reply</Button>
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={async () => setSaved(await copyForClaude([row]))}><ClipboardCopy className="size-3.5" />Copy for Claude</Button>
          {saved && <span role="status" className="inline-flex items-center gap-1 text-sm text-good"><Check className="size-3.5" />{saved}</span>}
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </section>
    </div>
  );
}
