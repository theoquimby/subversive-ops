"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { MyTraining } from "@/server/services/training";
import { Clock, ExternalLink, FileText, Upload } from "lucide-react";
import { useState, useTransition } from "react";
import { CertForm } from "../team/training/cert-form";
import { TickBox } from "../team/training/tick-box";
import { Sheet } from "../team/training/sheet";
import { ASSIGNMENT_LABEL, STATUS_LABEL, STATUS_TONE, statusSentence, validityText } from "../team/training/status";
import { tickMyStep, uploadMyCertificate } from "./training-actions";

type Cert = MyTraining["certs"][number];

export function MyTrainingPanel({ data, today }: { data: MyTraining; today: string }) {
  const [uploading, setUploading] = useState<Cert | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const todo = data.certs.filter((c) => c.required && c.status !== "valid").length + data.checklists.filter((c) => c.state !== "signed-off" && c.state !== "ready").length;
  return (
    <HelpZone id="my.training" className="mb-10">
      <section id="training" data-tour="my.training" className="scroll-mt-20">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-[0.95rem] font-semibold">My training <HelpTip id="my.training" /></h2>
          {todo > 0 && <Badge tone="warn">{todo} to do</Badge>}
        </div>

        {data.certs.length > 0 && (
          <Card className="divide-y divide-border">
            {data.certs.map((c) => {
              const waiting = c.latest && !c.latest.verifiedAt;
              const status = c.required || c.current ? c.status : "not-required";
              const urgent = c.required && (c.status === "missing" || c.status === "expired" || c.status === "expiring") && !waiting;
              return (
                <div key={c.typeId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                      <Badge tone={STATUS_TONE[status]}>{c.required ? STATUS_LABEL[status] : status === "not-required" ? "Optional" : STATUS_LABEL[status]}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {statusSentence({ status: c.status, expiresOn: c.expiresOn, daysLeft: c.daysLeft })}
                      {c.isAnnualTraining && " · every year"}
                    </div>
                    {waiting && <div className="mt-1 inline-flex items-center gap-1 text-xs text-warn"><Clock className="size-3.5" />Uploaded {shortDate(c.latest!.createdAt.slice(0, 10))} — waiting for a manager to check</div>}
                  </div>
                  <Button
                    size="sm"
                    variant={urgent ? "primary" : "secondary"}
                    className={cx("h-10 sm:h-8", urgent && "w-full sm:w-auto")}
                    onClick={() => { setFlash(null); setUploading(c); }}
                  >
                    <Upload className="size-4" />{c.current ? "Upload renewal" : "Upload"}
                  </Button>
                </div>
              );
            })}
          </Card>
        )}
        {flash && <p className="mt-2 text-sm text-good" aria-live="polite">{flash}</p>}

        {data.checklists.length > 0 && (
          <div className={cx("space-y-3", data.certs.length > 0 && "mt-4")} data-tour="my.checklists">
            {data.checklists.map((a) => <Checklist key={a.id} a={a} today={today} />)}
          </div>
        )}
      </section>

      {uploading && (
        <Sheet label={`Upload ${uploading.name}`} title={`Upload ${uploading.name}`} subtitle={`${validityText(uploading.validityMonths)}${uploading.issuer ? ` · ${uploading.issuer}` : ""}`} onClose={() => setUploading(null)}>
          {uploading.description && <p className="text-sm text-muted">{uploading.description}</p>}
          <CertForm
            fields={{ certTypeId: uploading.typeId }}
            validityMonths={uploading.validityMonths}
            today={today}
            requireFile
            submitLabel="Upload"
            onSubmit={uploadMyCertificate}
            onDone={(m) => { setUploading(null); setFlash(`${m}.`); }}
          />
          <p className="text-xs text-muted">A manager checks the photo against the original. Until then it shows as waiting.</p>
        </Sheet>
      )}
    </HelpZone>
  );
}

function Checklist({ a, today }: { a: MyTraining["checklists"][number]; today: string }) {
  const [done, setDone] = useState(new Set(a.doneStepIds));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const locked = a.state === "signed-off";
  const count = a.steps.filter((s) => done.has(s.id)).length;
  const overdue = !locked && a.dueOn && a.dueOn < today && count < a.steps.length;
  const st = locked ? ASSIGNMENT_LABEL["signed-off"] : count >= a.steps.length && a.steps.length ? ASSIGNMENT_LABEL.ready : overdue ? ASSIGNMENT_LABEL.overdue : null;
  const toggle = (id: string, v: boolean) => {
    const next = new Set(done);
    if (v) next.add(id); else next.delete(id);
    setDone(next);
    start(async () => {
      const r = await tickMyStep(a.id, id, v);
      if (r.error) { setError(r.error); setDone(new Set(done)); } else setError(null);
    });
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{a.title}</div>
          <div className="text-xs text-muted">
            <span className="num">{count} of {a.steps.length} done</span>
            {a.dueOn && <> · <span className={cx(overdue && "text-bad")}>due {shortDate(a.dueOn)}</span></>}
          </div>
        </div>
        {st && <Badge tone={st.tone}>{st.label === "Ready to sign off" ? "Done — waiting for sign-off" : st.label}</Badge>}
      </div>
      <div className="h-1 bg-surface-2" aria-hidden>
        <div className={cx("h-full transition-[width] duration-260 ease-motion", count >= a.steps.length ? "bg-good" : "bg-ink-2")} style={{ width: `${a.steps.length ? (count / a.steps.length) * 100 : 100}%` }} />
      </div>
      {a.description && <p className="px-4 pt-3 text-sm text-muted">{a.description}</p>}
      <ul className="divide-y divide-border">
        {a.steps.map((s) => {
          const on = done.has(s.id);
          return (
            <li key={s.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="pt-2"><TickBox checked={on} disabled={locked || pending} onChange={(v) => toggle(s.id, v)} label={s.title} /></div>
              <div className="min-w-0 flex-1 py-2">
                <div className={cx("text-sm", on && "text-muted line-through decoration-border-strong")}>{s.title}</div>
                {s.detail && <div className="mt-0.5 text-xs text-muted">{s.detail}</div>}
                {s.documentId && (
                  <a href={`/my/documents/${s.documentId}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-10 items-center gap-1.5 text-xs text-ink-2 underline-offset-2 hover:underline sm:min-h-0">
                    <FileText className="size-3.5" />{s.documentTitle}<ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="px-4 pb-3 text-xs text-bad" role="alert">{error}</p>}
      {locked && a.signedOffBy && <p className="border-t border-border px-4 py-2 text-xs text-muted">Signed off by {a.signedOffBy}{a.signedOffAt ? ` on ${shortDate(a.signedOffAt.slice(0, 10))}` : ""}.</p>}
    </Card>
  );
}
