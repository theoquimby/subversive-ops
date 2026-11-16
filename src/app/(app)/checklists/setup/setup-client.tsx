"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Card, cx } from "@/components/ui";
import { LINKABLE_PAGES, SHIFTS, weekdaysText } from "@/domain/checklists";
import type { TemplateView } from "@/server/services/checklists";
import { ArrowDown, ArrowUp, Check, Link2, Trash2, X } from "lucide-react";
import { useTransition } from "react";
import { AddRow } from "../../team/team-client";
import { addItem, addTemplate, deleteItem, deleteTemplate, moveItem, setItemField, setTemplateField, setTemplatePosition } from "../actions";

const ACTIVE = [{ value: "yes", label: "In use" }, { value: "no", label: "Off" }];
const LINKS = [{ value: "", label: "No link" }, ...LINKABLE_PAGES.map((p) => ({ value: p.href, label: p.label }))];

export function ChecklistSetup({ templates, positions }: { templates: TemplateView[]; positions: { id: string; name: string }[] }) {
  return (
    <div className="space-y-4">
      {templates.map((t) => <TemplateCard key={t.id} t={t} positions={positions} />)}
      <Card>
        {templates.length === 0 && <p className="px-4 pt-4 text-sm text-muted">No lists yet. Start with “Closing — bar”: the steps that make tomorrow's opener's life easy.</p>}
        <AddRow placeholder="New list, e.g. Closing — patio" label="New checklist" onAdd={addTemplate} />
      </Card>
    </div>
  );
}

function TemplateCard({ t, positions }: { t: TemplateView; positions: { id: string; name: string }[] }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <Card className={cx("overflow-hidden", !t.active && "opacity-60", pending && "opacity-60")} data-tour="checklists.template">
      <div className="flex flex-col gap-1 border-b border-border px-2 py-2 sm:flex-row sm:items-start sm:gap-2">
        <div className="min-w-0 sm:flex-1">
          <GridCell grid="cl" col="name" value={t.name} onSave={setTemplateField.bind(null, t.id, "name")} ariaLabel="List name" className="font-semibold" />
          <div className="flex flex-wrap items-center gap-2 px-2 pt-1">
            <span className="text-xs text-muted">Runs on</span>
            <div className="w-44">
              <GridCell grid="cl" col="days" value={weekdaysText(t.weekdays)} placeholder="Every day" onSave={setTemplateField.bind(null, t.id, "weekdays")} ariaLabel={`${t.name} days`} className="[&_input]:h-8 [&_input]:text-sm" />
            </div>
          </div>
          <div className="px-2 pt-1"><PositionToggles t={t} positions={positions} /></div>
        </div>
        <div className="flex items-center gap-1 px-2 sm:px-0">
          <Badge>{t.items.filter((i) => i.active).length} steps</Badge>
          <div className="w-28"><GridSelect value={t.shift} options={SHIFTS} onSave={setTemplateField.bind(null, t.id, "shift")} ariaLabel={`${t.name} shift`} /></div>
          <div className="w-24"><GridSelect value={t.active ? "yes" : "no"} options={ACTIVE} onSave={setTemplateField.bind(null, t.id, "active")} ariaLabel={`${t.name} in use`} /></div>
          <button
            type="button"
            aria-label={`Delete ${t.name}`}
            onClick={async () => {
              if (!(await confirm({ title: `Delete “${t.name}”?`, body: "Its steps and every day's ticks and sign-offs go with it. Turn it Off instead to keep the history.", confirmLabel: "Delete", danger: true }))) return;
              start(async () => { await deleteTemplate(t.id); });
            }}
            className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {t.items.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Add the first step below.</p> : (
        <ol className="divide-y divide-border">
          {t.items.map((s, i) => (
            <li key={s.id} className={cx("flex items-start gap-1 px-2 py-1.5", !s.active && "opacity-60")}>
              <span className="num mt-2.5 w-6 shrink-0 text-right text-xs text-muted">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <GridCell grid={`cli-${t.id}`} col="title" value={s.title} onSave={setItemField.bind(null, s.id, "title")} ariaLabel={`Step ${i + 1}`} />
                <GridCell grid={`cli-${t.id}`} col="detail" value={s.detail} placeholder="How, or what good looks like (optional)" onSave={setItemField.bind(null, s.id, "detail")} ariaLabel={`Step ${i + 1} details`} className="text-muted [&_input]:h-8 [&_input]:text-xs" />
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-1 px-1 sm:grid-cols-[auto_minmax(0,12rem)_auto_minmax(0,10rem)_auto_minmax(0,7rem)]">
                  <Link2 className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <GridSelect value={s.href ?? ""} options={LINKS} onSave={setItemField.bind(null, s.id, "href")} ariaLabel={`Step ${i + 1} links to`} className="text-xs" />
                  <span className="text-xs text-muted">Only on</span>
                  <GridCell grid={`cli-${t.id}`} col="days" value={weekdaysText(s.weekdays)} placeholder="Every run" onSave={setItemField.bind(null, s.id, "weekdays")} ariaLabel={`Step ${i + 1} days`} className="[&_input]:h-8 [&_input]:text-xs" />
                  <span className="hidden text-xs text-muted sm:inline">Step</span>
                  <div className="col-span-2 sm:col-span-1"><GridSelect value={s.active ? "yes" : "no"} options={ACTIVE} onSave={setItemField.bind(null, s.id, "active")} ariaLabel={`Step ${i + 1} in use`} className="text-xs" /></div>
                </div>
              </div>
              <StepButtons id={s.id} first={i === 0} last={i === t.items.length - 1} title={s.title} />
            </li>
          ))}
        </ol>
      )}
      <AddRow placeholder="Add a step, e.g. Bleach the drains" label={`Add a step to ${t.name}`} onAdd={(title) => addItem(t.id, title)} />
    </Card>
  );
}

function PositionToggles({ t, positions }: { t: TemplateView; positions: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  if (!positions.length) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-1", pending && "opacity-60")} role="group" aria-label="For positions">
      <span className="mr-1 text-xs text-muted">{t.positionIds.length ? "For" : "For everyone, or just"}</span>
      {positions.map((p) => {
        const on = t.positionIds.includes(p.id);
        return (
          <button key={p.id} type="button" aria-pressed={on} disabled={pending} onClick={() => start(async () => { await setTemplatePosition(t.id, p.id, !on); })}
            className={cx("inline-flex h-9 items-center gap-1 rounded-md border px-2 text-xs transition-colors duration-120 sm:h-7", on ? "border-ink/80 bg-primary text-primary-ink" : "border-border text-muted hover:bg-surface-2 hover:text-ink-2")}>
            {on && <Check className="size-3" />}{p.name}
          </button>
        );
      })}
    </div>
  );
}

function StepButtons({ id, first, last, title }: { id: string; first: boolean; last: boolean; title: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const btn = "grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30 sm:size-7";
  return (
    <div className={cx("flex shrink-0 items-center", pending && "opacity-50")}>
      <button type="button" className={cx(btn, "hidden sm:grid")} aria-label={`Move ${title} up`} disabled={first || pending} onClick={() => start(async () => { await moveItem(id, -1); })}><ArrowUp className="size-3.5" /></button>
      <button type="button" className={cx(btn, "hidden sm:grid")} aria-label={`Move ${title} down`} disabled={last || pending} onClick={() => start(async () => { await moveItem(id, 1); })}><ArrowDown className="size-3.5" /></button>
      <button type="button" className={cx(btn, "hover:bg-bad-bg hover:text-bad")} aria-label={`Delete step ${title}`} disabled={pending} onClick={async () => {
        if (!(await confirm({ title: "Delete this step?", body: `${title}. Past ticks for it go too — set it to Off to keep them.`, confirmLabel: "Delete", danger: true }))) return;
        start(async () => { await deleteItem(id); });
      }}><X className="size-3.5" /></button>
    </div>
  );
}
