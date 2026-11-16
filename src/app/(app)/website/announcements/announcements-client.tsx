"use client";

import { Checkbox, DataTable, DetailRow, type Column } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridSelect } from "@/components/grid";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Section, Select, Textarea } from "@/components/ui";
import { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_TONES, announcementWhen, checkAnnouncement, isTone, TONE_HINT, TONE_LABEL, type AnnouncementField, type AnnouncementInput, type AnnouncementTone } from "@/domain/websiteAnnouncements";
import { shortDate } from "@/lib/format";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AnnouncementRow, EventLinkOption } from "@/server/services/websiteAnnouncements";
import { addAnnouncement, editAnnouncement, orderAnnouncements, removeAnnouncement, setAnnouncementOn, showAgain } from "./actions";
import { BandLine, PhoneBand, TONE_STYLE } from "./band-preview";

const toneOf = (t: string): AnnouncementTone => (isTone(t) ? t : "info");
const isExternal = (href: string | null) => !!href && href.startsWith("https://");

export function AnnouncementsTab({ rows, events, today, siteUrl }: { rows: AnnouncementRow[]; events: EventLinkOption[]; today: string; siteUrl: string | null }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const move = (id: string, d: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setError(null);
    start(async () => {
      const r = await orderAnnouncements(ids);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  // What the band shows today: the first three that are on and stand today, as the website picks them.
  const live = rows.filter((r) => r.active && announcementWhen(r.from, r.until, today).state === "showing").slice(0, 3);

  const columns = useMemo<Column<AnnouncementRow>[]>(
    () => [
      {
        id: "line",
        header: "Line",
        width: 320,
        hideable: false,
        csv: (r) => r.text,
        cell: (r) => (
          <div className="min-w-0 py-1">
            <div className={cx("text-sm", !r.active && "text-muted line-through")}>{r.text}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block size-2.5 rounded-full ring-1 ring-border" style={{ background: TONE_STYLE[toneOf(r.tone)].bg }} />{TONE_LABEL[toneOf(r.tone)]}</span>
              {r.linkLabel && <span>· Link: {r.linkLabel}</span>}
            </div>
          </div>
        ),
      },
      { id: "when", header: "Shows", width: 190, csv: (r) => announcementWhen(r.from, r.until, today).label, cell: (r) => <WhenBadge row={r} today={today} /> },
      { id: "on", header: "On the website", edit: true, width: 140, csv: (r) => (r.active ? "on" : "off"), cell: (r) => <GridSelect value={r.active ? "on" : "off"} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} ariaLabel={`Show "${r.text}" on the website`} onSave={(v) => setAnnouncementOn(r.id, v)} /> },
      {
        id: "order",
        header: "Order",
        width: 110,
        cell: (r) => {
          const i = rows.findIndex((x) => x.id === r.id);
          return (
            <div className="flex items-center gap-1 px-1">
              <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`Move "${r.text}" up`} disabled={pending || i <= 0} onClick={() => move(r.id, -1)}><ArrowUp className="size-4" /></Button>
              <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`Move "${r.text}" down`} disabled={pending || i < 0 || i >= rows.length - 1} onClick={() => move(r.id, 1)}><ArrowDown className="size-4" /></Button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, today, pending],
  );

  return (
    <HelpZone id="website.announcements" tour="website.announcements">
      <Section
        title="Announcements"
        help="website.announcements"
        description="Short lines in a band under the website's header, on every page: a closure, a big night, a change. The website shows the first three that are on today, in this order. Visitors can close a line; it stays closed for them."
        actions={!adding ? <Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus className="size-4" />Add announcement</Button> : undefined}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 space-y-4">
            {adding && (
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold">New announcement</h3>
                <AnnouncementForm events={events} today={today} onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />
              </Card>
            )}
            {error && <p className="text-sm text-bad" role="alert">{error}</p>}
            <DataTable
              id="website-announcements"
              rows={rows}
              rowKey={(r) => r.id}
              columns={columns}
              noun={["announcement", "announcements"]}
              searchText={(r) => `${r.text} ${r.linkLabel ?? ""}`}
              searchPlaceholder="Search announcements"
              urlSearch={false}
              csvName="website-announcements"
              help="website.announcements"
              rowClassName={(r) => (!r.active || announcementWhen(r.from, r.until, today).state === "ended" ? "opacity-60" : undefined)}
              summary={(vis) => [
                { value: vis.filter((r) => r.active && announcementWhen(r.from, r.until, today).state === "showing").length, label: "showing now" },
                { value: vis.filter((r) => r.active && announcementWhen(r.from, r.until, today).state === "upcoming").length, label: "coming up" },
              ]}
              card={(r) => ({
                title: r.text,
                subtitle: announcementWhen(r.from, r.until, today).label,
                value: !r.active ? <span className="text-xs text-muted">Off</span> : <span className="inline-block size-3 rounded-full ring-1 ring-border" style={{ background: TONE_STYLE[toneOf(r.tone)].bg }} aria-label={TONE_LABEL[toneOf(r.tone)]} />,
                sub: r.linkLabel ? `Link: ${r.linkLabel}` : undefined,
              })}
              drawerTitle={() => "Announcement"}
              drawer={(r, close) => <AnnouncementDrawer row={r} index={rows.findIndex((x) => x.id === r.id)} count={rows.length} events={events} today={today} siteUrl={siteUrl} onMove={(d) => move(r.id, d)} onClose={() => { close(); router.refresh(); }} />}
              empty={
                <div className="p-6 text-sm text-muted">
                  <p>No announcements yet. Add one for a closure or a big night, like “Closed Thanksgiving Day.”</p>
                  {!adding && <Button className="mt-3" size="sm" onClick={() => setAdding(true)}><Plus className="size-4" />Add announcement</Button>}
                </div>
              }
            />
          </div>
          <div className="space-y-2">
            <h3 className="flex items-center gap-1 text-sm font-semibold">The band today <HelpTip id="website.announcements.band" /></h3>
            <PhoneBand lines={live.map((r) => ({ key: r.id, text: r.text, tone: toneOf(r.tone), linkLabel: r.linkLabel, external: isExternal(r.linkHref) }))} label={rows.filter((r) => r.active && announcementWhen(r.from, r.until, today).state === "showing").length > 3 ? "Only the first three show. Move the one that matters most to the top." : "On a phone, as the website shows it today"} />
          </div>
        </div>
      </Section>
    </HelpZone>
  );
}

function WhenBadge({ row, today }: { row: AnnouncementRow; today: string }) {
  const w = announcementWhen(row.from, row.until, today);
  if (!row.active) return <span className="text-sm text-muted">Off · {w.label}</span>;
  return <Badge tone={w.state === "showing" ? "good" : "neutral"}>{w.label}</Badge>;
}

function AnnouncementDrawer({ row, index, count, events, today, siteUrl, onMove, onClose }: { row: AnnouncementRow; index: number; count: number; events: EventLinkOption[]; today: string; siteUrl: string | null; onMove: (d: -1 | 1) => void; onClose: () => void }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const w = announcementWhen(row.from, row.until, today);
  const again = () =>
    start(async () => {
      const r = await showAgain(row.id);
      setNote(r.error ?? "Done. Everyone sees it again, including people who closed it.");
    });
  const remove = async () => {
    if (!(await confirm({ title: "Delete this announcement?", body: "It comes off the website and can't be brought back.", confirmLabel: "Delete", danger: true }))) return;
    start(async () => {
      await removeAnnouncement(row.id);
      onClose();
    });
  };
  return (
    <div className="space-y-4">
      <div className="divide-y divide-border">
        <DetailRow label="Shows">{row.active ? w.label : `Off · ${w.label}`}</DetailRow>
        <DetailRow label="Place in the band">
          <span className="inline-flex items-center gap-1">
            <span className="num text-sm">{index + 1} of {count}</span>
            <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label="Move up" disabled={index <= 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
            <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label="Move down" disabled={index >= count - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
          </span>
        </DetailRow>
        {row.linkHref && <DetailRow label="Link goes to"><span className="text-sm break-all text-ink-2">{row.linkHref.startsWith("/") && siteUrl ? `${siteUrl}${row.linkHref}` : row.linkHref}</span></DetailRow>}
      </div>
      <AnnouncementForm row={row} events={events} today={today} onDone={onClose} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button size="sm" disabled={pending} onClick={again}>Show again to people who closed it</Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={remove}>Delete</Button>
      </div>
      {note && <p className="text-sm text-ink-2" role="status">{note}</p>}
    </div>
  );
}

type LinkMode = "none" | "event" | "web";

function AnnouncementForm({ row, events, today, onDone, onCancel }: { row?: AnnouncementRow; events: EventLinkOption[]; today: string; onDone: () => void; onCancel?: () => void }) {
  const [text, setText] = useState(row?.text ?? "");
  const [tone, setTone] = useState<AnnouncementTone>(toneOf(row?.tone ?? "info"));
  const initialMode: LinkMode = !row?.linkHref ? "none" : row.linkHref.startsWith("/") ? "event" : "web";
  const [mode, setMode] = useState<LinkMode>(initialMode);
  const [eventHref, setEventHref] = useState(initialMode === "event" ? row!.linkHref! : "");
  const [webHref, setWebHref] = useState(initialMode === "web" ? row!.linkHref! : "");
  const [label, setLabel] = useState(row?.linkLabel ?? "Details");
  const [from, setFrom] = useState(row?.from ?? "");
  const [until, setUntil] = useState(row?.until ?? "");
  const [again, setAgain] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<AnnouncementField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const textChanged = !!row && text.replace(/\s+/g, " ").trim() !== row.text;
  const input: AnnouncementInput = { text, tone, linkHref: mode === "event" ? eventHref : mode === "web" ? webHref : "", linkLabel: mode === "none" ? "" : label, from, until };
  const len = text.replace(/\s+/g, " ").trim().length;
  // An event that has passed still shows when it's the one already linked.
  const eventOptions = events.map((e) => ({ value: e.href, label: e.title, hint: shortDate(e.date) }));
  if (eventHref && !eventOptions.some((o) => o.value === eventHref)) eventOptions.unshift({ value: eventHref, label: eventHref, hint: "Linked now" });

  const save = () => {
    setError(null);
    const local = checkAnnouncement(input);
    if (!local.ok) {
      setErrors(local.errors);
      return;
    }
    setErrors({});
    start(async () => {
      const r = row ? await editAnnouncement(row.id, input, again || false) : await addAnnouncement(input);
      if (r.errors) setErrors(r.errors);
      else if (r.error) setError(r.error);
      else onDone();
    });
  };

  return (
    <div className="space-y-4">
      <Field label="What it says" hint={<span className={cx("num", len > ANNOUNCEMENT_LIMITS.text && "text-bad")}>{len}/{ANNOUNCEMENT_LIMITS.text}{len > ANNOUNCEMENT_LIMITS.twoLines && len <= ANNOUNCEMENT_LIMITS.text ? " · over 90 runs to three lines on a phone" : " · under 90 stays on two lines on a phone"}</span>}>
        <Textarea rows={2} value={text} maxLength={400} onChange={(e) => setText(e.target.value)} placeholder="Closed Thanksgiving Day." aria-invalid={!!errors.text} />
      </Field>
      {errors.text && <p className="-mt-2 text-sm text-bad">{errors.text}</p>}

      <div>
        <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Colour</span>
        <div role="radiogroup" aria-label="Colour" className="grid gap-2 sm:grid-cols-3">
          {ANNOUNCEMENT_TONES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tone === t} onClick={() => setTone(t)} className={cx("overflow-hidden rounded-lg text-left ring-1 transition-shadow", tone === t ? "ring-2 ring-ink" : "ring-border hover:ring-ink-2/40")}>
              <BandLine text={TONE_LABEL[t]} tone={t} />
              <span className="block bg-surface px-3 py-1.5 text-xs text-muted">{TONE_HINT[t]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="block text-[0.8rem] font-medium text-ink-2">Link</span>
        <div role="radiogroup" aria-label="Link" className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5">
          {([["none", "No link"], ["event", "An event"], ["web", "Web address"]] as const).map(([m, l]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cx("inline-flex h-10 items-center rounded-md px-3 text-sm sm:h-8", mode === m ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>{l}</button>
          ))}
        </div>
        {mode === "event" && (
          events.length || eventHref ? (
            <Select value={eventHref} onChange={(e) => setEventHref(e.target.value)} options={eventOptions} searchable placeholder="Pick an event" aria-label="Event to link to" />
          ) : (
            <p className="text-sm text-muted">No upcoming events on the website. Add them on Events, or link a web address.</p>
          )
        )}
        {mode === "web" && <Input value={webHref} onChange={(e) => setWebHref(e.target.value)} placeholder="https://…" inputMode="url" aria-label="Web address" aria-invalid={!!errors.linkHref} />}
        {errors.linkHref && <p className="text-sm text-bad">{errors.linkHref}</p>}
        {mode !== "none" && (
          <Field label="Link words" hint={<span className="num">{label.trim().length}/{ANNOUNCEMENT_LIMITS.label}</span>}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Details" maxLength={80} aria-invalid={!!errors.linkLabel} />
          </Field>
        )}
        {errors.linkLabel && <p className="text-sm text-bad">{errors.linkLabel}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First day" hint={from ? <button type="button" className="underline" onClick={() => setFrom("")}>Clear</button> : "Empty: from now"}>
          <DatePicker value={from} onChange={(e) => setFrom(e.target.value)} today={today} aria-label="First day it shows" />
        </Field>
        <Field label="Last day" hint={until ? <button type="button" className="underline" onClick={() => setUntil("")}>Clear</button> : "Empty: until you turn it off"}>
          <DatePicker value={until} onChange={(e) => setUntil(e.target.value)} min={from || undefined} today={today} aria-label="Last day it shows" />
        </Field>
      </div>
      {(errors.from || errors.until) && <p className="text-sm text-bad">{errors.from ?? errors.until}</p>}
      <p className="text-sm text-ink-2">{announcementWhen(from || null, until || null, today).label}{from || until ? " (New York days, both included)" : ""}</p>

      <PhoneBand lines={[{ key: "p", text: text.replace(/\s+/g, " ").trim(), tone, linkLabel: mode === "none" ? null : label.trim() || null, external: mode === "web" }]} label="Preview on a phone" />

      {row && (
        <div className="flex min-h-10 items-start gap-2 text-sm">
          <Checkbox checked={again} onChange={() => setAgain((a) => !a)} label="Show again to people who closed it" className="m-0 mt-[-6px]" />
          <button type="button" className="text-left" onClick={() => setAgain((a) => !a)}>
            Show again to people who closed it
            <span className="block text-xs text-muted">{textChanged ? "You changed the words. Tick this so everyone sees the new line." : "Leave it off for a small fix, so people who closed it aren't shown it twice."}</span>
          </button>
        </div>
      )}

      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={save}>{pending ? "Saving…" : row ? "Save" : "Add to the website"}</Button>
        {onCancel && <Button variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
