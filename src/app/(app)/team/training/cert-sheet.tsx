"use client";

import { useConfirm } from "@/components/dialog";
import { Badge, Button, cx } from "@/components/ui";
import type { CellView, CertView, PersonView, TypeView } from "@/server/services/training";
import { BadgeCheck, ExternalLink, Eye, FileText, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { InvoiceViewer } from "../../invoices/[id]/viewer";
import { addCertificate, deleteCertificate, setCertificateVerified } from "./actions";
import { CertForm } from "./cert-form";
import { Sheet } from "./sheet";
import { fullDateOf, REASON_LABEL, STATUS_LABEL, STATUS_TONE, statusSentence, validityText } from "./status";

const fileUrl = (id: string) => `/my/training/file/${id}`;

/** One person × one certificate type: what's on file, add or renew, verify, history. */
export function CertSheet({ person, type, cell, today, onClose }: { person: PersonView; type: TypeView; cell: CellView; today: string; onClose: () => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const status = cell.required || cell.current ? cell.status : "not-required";
  const first = person.name.split(" ")[0];
  return (
    <Sheet label={`${person.name}: ${type.name}`} onClose={onClose} title={type.name} subtitle={<>{person.name} · {cell.reason ? REASON_LABEL[cell.reason] : "Optional for them"}</>}>
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          <span className="text-sm text-ink-2">{statusSentence(cell)}</span>
        </div>
        {type.description && <p className="mt-2 text-sm text-muted">{type.description}</p>}
        <p className="mt-1 text-xs text-muted">{validityText(type.validityMonths)}{type.issuer ? ` · ${type.issuer}` : ""}</p>
      </section>

      {cell.current && <CurrentCert c={cell.current} />}

      <section data-tour="training.add-cert">
        <h3 className="mb-2 text-sm font-semibold">{cell.current ? "Renew — add the new certificate" : `Add ${first}'s certificate`}</h3>
        <CertForm
          fields={{ employeeId: person.id, certTypeId: type.id }}
          validityMonths={type.validityMonths}
          today={today}
          verifyToggle
          onSubmit={addCertificate}
          onDone={setSaved}
        />
        {saved && <p className="mt-2 text-sm text-good" aria-live="polite">{saved}. The old certificate stays in the history below.</p>}
        {!person.hasLogin && <p className="mt-2 text-xs text-muted">{first} has no login, so they can&apos;t upload it themselves.</p>}
      </section>

      {cell.history.length > (cell.current ? 1 : 0) && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">History</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {cell.history.filter((h) => h.id !== cell.current?.id).map((h) => <HistoryRow key={h.id} c={h} />)}
          </ul>
        </section>
      )}
    </Sheet>
  );
}

function CurrentCert({ c }: { c: CertView }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [viewing, setViewing] = useState(false);
  const isImage = c.mime?.startsWith("image/");
  return (
    <section className={cx("rounded-xl border border-border p-4", pending && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Issued</dt><dd className="num">{fullDateOf(c.issuedOn)}</dd>
          <dt className="text-muted">Expires</dt><dd className="num">{c.expiresOn ? fullDateOf(c.expiresOn) : "Never"}{c.overridden && <span className="text-xs text-muted"> · set by hand</span>}</dd>
          {c.number && <><dt className="text-muted">Number</dt><dd className="num">{c.number}</dd></>}
          <dt className="text-muted">Added</dt><dd>{c.uploadedBy ?? "—"}</dd>
        </dl>
        {c.verifiedAt ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-good"><BadgeCheck className="size-4" />Verified{c.verifiedBy ? ` by ${c.verifiedBy}` : ""}</span>
        ) : (
          <Badge tone="warn">Not verified</Badge>
        )}
      </div>
      {c.notes && <p className="mt-2 text-sm text-ink-2">{c.notes}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {c.hasFile ? (
          <Button size="sm" className="h-10 sm:h-8" onClick={() => setViewing((v) => !v)} aria-expanded={viewing}><Eye className="size-4" />{viewing ? "Hide" : isImage ? "View photo" : "View PDF"}</Button>
        ) : (
          <span className="inline-flex h-10 items-center text-xs text-muted sm:h-8">No photo on file</span>
        )}
        {c.verifiedAt ? (
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => { await setCertificateVerified(c.id, false); })}>Undo verify</Button>
        ) : (
          <Button size="sm" variant="primary" className="h-10 sm:h-8" disabled={pending} data-tour="training.verify" onClick={() => start(async () => { await setCertificateVerified(c.id, true); })}><BadgeCheck className="size-4" />Mark verified</Button>
        )}
        <Button
          size="sm"
          variant="danger"
          className="ml-auto h-10 sm:h-8"
          disabled={pending}
          aria-label="Delete this certificate"
          onClick={async () => {
            if (!(await confirm({ title: "Delete this certificate?", body: "Only for mistakes. To renew, add the new one instead so the history stays.", confirmLabel: "Delete", danger: true }))) return;
            start(async () => { await deleteCertificate(c.id); });
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {viewing && c.hasFile && (
        <div className="mt-3 h-80 animate-fade-in sm:h-96">
          <InvoiceViewer src={`${fileUrl(c.id)}`} type={c.mime} invoiceId={c.id} locked label="Certificate" />
        </div>
      )}
    </section>
  );
}

function HistoryRow({ c }: { c: CertView }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <span className="min-w-0">
        <span className="num block">{fullDateOf(c.issuedOn)} → {c.expiresOn ? fullDateOf(c.expiresOn) : "no expiry"}</span>
        <span className="block text-xs text-muted">{c.number ? `#${c.number} · ` : ""}{c.verifiedAt ? "Verified" : "Not verified"}</span>
      </span>
      {c.hasFile ? (
        <a href={fileUrl(c.id)} target="_blank" rel="noreferrer" className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-2 hover:bg-surface-2 sm:h-8">
          <FileText className="size-3.5" />Open <ExternalLink className="size-3" />
        </a>
      ) : <span className="text-xs text-muted">No file</span>}
    </li>
  );
}
