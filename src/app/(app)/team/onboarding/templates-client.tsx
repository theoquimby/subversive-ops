"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Input, Section, Select } from "@/components/ui";
import { KIND_LABEL, ONBOARDING_KINDS, type OnboardingKind } from "@/domain/onboarding";
import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { addTemplate, addTemplateItem, deleteTemplate, deleteTemplateItem, setTemplateField, setTemplateItemField } from "../workforce-actions";

interface TItem {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  refId: string | null;
  required: boolean;
  staffCanTick: boolean;
}

type Opt = { value: string; label: string };
const YES_NO = [{ value: "yes", label: "Required" }, { value: "no", label: "Optional" }];
const WHO = [{ value: "no", label: "Manager ticks" }, { value: "yes", label: "They tick it" }];

export function TemplatesEditor({ templates, positions, refs }: { templates: { id: string; name: string; positionIds: string[]; items: TItem[] }[]; positions: { id: string; name: string }[]; refs: Record<"DOCUMENT" | "TRAINING" | "CERT", Opt[]> }) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const [newName, setNewName] = useState("");
  const confirm = useConfirm();
  const run = (fn: () => Promise<{ error?: string; ok?: string } | void>) =>
    start(async () => {
      const r = await fn();
      if (r?.error) show(r.error, "bad");
      else if (r?.ok) show(r.ok);
    });
  const refLabel = (kind: string, id: string | null) => (id ? refs[kind as keyof typeof refs]?.find((o) => o.value === id)?.label ?? "Removed" : null);

  return (
    <Section help="team.onboarding.templates" title="Checklists" description="What a new hire works through. Linked items (documents, training, certificates, availability, emergency contact) tick themselves when the real thing is done. Edits apply to the next person you start.">
      {toast}
      <div className="flex flex-col gap-4">
        {templates.map((t) => (
          <Card key={t.id} className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center">
              <GridCell grid="ob-tpl" col="name" value={t.name} onSave={(v) => setTemplateField(t.id, "name", v)} ariaLabel="Checklist name" className="font-medium sm:w-56" />
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">For:</span>
                {positions.map((p) => {
                  const on = t.positionIds.includes(p.id);
                  return (
                    <button key={p.id} type="button" role="checkbox" aria-checked={on} disabled={pending} onClick={() => run(() => setTemplateField(t.id, "positionIds", on ? t.positionIds.filter((x) => x !== p.id) : [...t.positionIds, p.id]))} className={cx("min-h-9 rounded-full border px-2.5 text-xs transition-colors duration-120", on ? "border-ink bg-ink text-surface" : "border-border text-ink-2")}>
                      {p.name}
                    </button>
                  );
                })}
                {t.positionIds.length === 0 && <span className="text-xs text-muted">everyone</span>}
              </div>
              <Button size="sm" variant="ghost" className="self-end text-bad max-sm:h-10 sm:self-auto" disabled={pending} aria-label={`Remove ${t.name}`} onClick={async () => { if (await confirm({ title: `Remove “${t.name}”?`, body: "Checklists already started keep their items.", confirmLabel: "Remove", danger: true })) run(() => deleteTemplate(t.id)); }}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <ul className="divide-y divide-border">
              {t.items.map((i) => (
                <li key={i.id} className="grid grid-cols-[1fr_auto] items-center gap-x-2 px-3 py-1.5 sm:grid-cols-[7.5rem_1fr_8rem_8rem_auto]">
                  <span className="hidden text-xs text-muted sm:block"><Badge>{KIND_LABEL[i.kind as OnboardingKind] ?? i.kind}</Badge></span>
                  <div className="min-w-0">
                    <GridCell grid="ob-item" col="title" value={i.title} onSave={(v) => setTemplateItemField(i.id, "title", v)} ariaLabel="Item" />
                    {refLabel(i.kind, i.refId) && <span className="block px-2 text-xs text-muted">→ {refLabel(i.kind, i.refId)}</span>}
                  </div>
                  <div className="col-start-1 sm:col-start-auto"><GridSelect value={i.required ? "yes" : "no"} options={YES_NO} onSave={(v) => setTemplateItemField(i.id, "required", v)} ariaLabel={`${i.title} required`} /></div>
                  <div className="hidden sm:block">{i.kind === "TASK" ? <GridSelect value={i.staffCanTick ? "yes" : "no"} options={WHO} onSave={(v) => setTemplateItemField(i.id, "staffCanTick", v)} ariaLabel={`${i.title} who ticks`} /> : <span className="px-2 text-xs text-muted">{i.kind === "PAYROLL" ? "They tick it" : "Ticks itself"}</span>}</div>
                  <Button size="sm" variant="ghost" className="row-span-2 max-sm:h-10 sm:row-span-1" disabled={pending} aria-label={`Remove ${i.title}`} onClick={() => run(() => deleteTemplateItem(i.id))}><Trash2 className="size-3.5" aria-hidden /></Button>
                </li>
              ))}
            </ul>
            <AddItem templateId={t.id} refs={refs} pending={pending} run={run} />
          </Card>
        ))}
        <div className="flex gap-2">
          <Input aria-label="New checklist name" placeholder="New checklist (e.g. Kitchen)" value={newName} onChange={(e) => setNewName(e.target.value)} className="max-sm:h-11 sm:w-64" />
          <Button disabled={pending || !newName.trim()} className="max-sm:h-11" onClick={() => run(async () => { const r = await addTemplate(newName); if (!r.error) setNewName(""); return r; })}><Plus className="size-4" aria-hidden /> Add checklist</Button>
        </div>
      </div>
    </Section>
  );
}

function AddItem({ templateId, refs, pending, run }: { templateId: string; refs: Record<"DOCUMENT" | "TRAINING" | "CERT", Opt[]>; pending: boolean; run: (fn: () => Promise<{ error?: string; ok?: string } | void>) => void }) {
  const [kind, setKind] = useState<OnboardingKind>("TASK");
  const [title, setTitle] = useState("");
  const [refId, setRefId] = useState("");
  const refOpts = refs[kind as keyof typeof refs];
  const ANY: Record<string, string> = { DOCUMENT: "Every document that needs signing", TRAINING: "Their assigned training", CERT: "Every certificate their position needs" };
  return (
    <div className="flex flex-col gap-2 border-t border-border bg-surface-2/40 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="sm:w-44"><Select aria-label="Kind" value={kind} onChange={(e) => { setKind(e.target.value as OnboardingKind); setRefId(""); }} options={ONBOARDING_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} className="max-sm:h-11" /></div>
      {refOpts && <div className="sm:w-56"><Select aria-label="Which one" value={refId} onChange={(e) => setRefId(e.target.value)} options={[{ value: "", label: ANY[kind] }, ...refOpts]} className="max-sm:h-11" /></div>}
      <Input aria-label="Item title" placeholder={kind === "TASK" ? "e.g. Walk-in tour with the chef" : "Title"} value={title} onChange={(e) => setTitle(e.target.value)} className="max-sm:h-11 sm:flex-1" />
      <Button size="sm" disabled={pending || title.trim().length < 2} className="max-sm:h-11" onClick={() => run(async () => { const r = await addTemplateItem(templateId, { kind, title, refId: refId || undefined, required: kind !== "TASK", staffCanTick: false }); if (!r.error) setTitle(""); return r; })}>
        <Plus className="size-4" aria-hidden /> Add
      </Button>
    </div>
  );
}
