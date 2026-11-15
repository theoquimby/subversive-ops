"use client";

import { DataTable, DetailRow, type Column, type Filter } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, LinkButton, Section } from "@/components/ui";
import { EVENT_KIND_LABEL, isEventKind } from "@/domain/events";
import { hhmmLabel } from "@/domain/websiteHours";
import { shortDate } from "@/lib/format";
import { ImageUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { removeEventImage, setEventWebField, setHolidaysClosed, uploadEventImage } from "../actions";

export interface WebEventRow {
  id: string;
  date: string;
  title: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  past: boolean;
  slug: string | null;
  hidden: boolean;
  webKind: string | null;
  closed: boolean | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ticketUrl: string | null;
  rsvpUrl: string | null;
  priceLabel: string | null;
  featured: boolean;
  kitchenCloseOverride: string | null;
  barCloseOverride: string | null;
}

const kindLabel = (k: string) => (isEventKind(k) ? EVENT_KIND_LABEL[k] : k);
const timeText = (e: WebEventRow) => [e.startTime ? hhmmLabel(e.startTime) : null, e.endTime ? hhmmLabel(e.endTime) : null].filter(Boolean).join("–");
const closedValue = (c: boolean | null) => (c === true ? "closed" : c === false ? "open" : "");
const isClosedOnSite = (e: WebEventRow, holidaysClosed: boolean) => (e.closed != null ? e.closed : e.kind === "CLOSURE" || (e.kind === "HOLIDAY" && holidaysClosed));

/** Shrink to at most 1600 px on the long side, as WebP (JPEG where WebP isn't supported). */
async function shrink(file: File): Promise<{ file: File; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.82));
  const out = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
  if (!out) throw new Error("Couldn't read that image.");
  return { file: new File([out], out.type === "image/webp" ? "event.webp" : "event.jpg", { type: out.type }), width: c.width, height: c.height };
}

function PictureCell({ row }: { row: WebEventRow }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    start(async () => {
      try {
        const small = await shrink(f);
        const fd = new FormData();
        fd.set("eventId", row.id);
        fd.set("file", small.file);
        fd.set("width", String(small.width));
        fd.set("height", String(small.height));
        const r = await uploadEventImage(fd);
        if (r.error) setError(r.error);
        else router.refresh();
      } catch {
        setError("Couldn't read that image.");
      }
      if (input.current) input.current.value = "";
    });
  };
  const remove = async () => {
    // Ask first, then save in a transition (never await the dialog inside one).
    if (!(await confirm({ title: `Remove the picture for ${row.title}?`, body: "The website shows the event without a picture.", confirmLabel: "Remove", danger: true }))) return;
    start(async () => {
      await removeEventImage(row.id);
      router.refresh();
    });
  };
  return (
    <div className="flex items-center gap-1.5 px-1">
      {row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.imageUrl} alt="" className="h-9 w-14 shrink-0 rounded-md object-cover ring-1 ring-border" />
      ) : (
        <span aria-hidden className="grid h-9 w-14 shrink-0 place-items-center rounded-md text-[0.65rem] text-muted ring-1 ring-border ring-inset">none</span>
      )}
      <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`${row.imageUrl ? "Replace" : "Upload"} picture for ${row.title}`} disabled={pending} onClick={() => input.current?.click()}><ImageUp className="size-4" /></Button>
      {row.imageUrl && <Button size="sm" variant="ghost" className="size-10 p-0 text-muted hover:text-bad sm:size-8" aria-label={`Remove picture for ${row.title}`} disabled={pending} onClick={remove}><Trash2 className="size-4" /></Button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

export function EventsTab({ rows, past, holidaysClosed }: { rows: WebEventRow[]; past: boolean; holidaysClosed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hol, setHol] = useState(holidaysClosed);
  const save = (r: WebEventRow, f: Parameters<typeof setEventWebField>[1]) => (v: string) => setEventWebField(r.id, f, v);

  const columns = useMemo<Column<WebEventRow>[]>(
    () => [
      {
        id: "event",
        header: "Event",
        width: 240,
        hideable: false,
        sort: (e) => `${e.date} ${e.startTime ?? ""}`,
        firstDir: "asc",
        csv: (e) => `${e.date} ${e.title}`,
        cell: (e) => (
          <div className="min-w-0">
            <div className={cx("font-medium", e.hidden && "text-muted line-through")}>{e.title}</div>
            <div className="text-xs text-muted">{shortDate(e.date)}{timeText(e) ? ` · ${timeText(e)}` : ""} · {kindLabel(e.kind)}</div>
          </div>
        ),
      },
      { id: "shown", header: "On website", edit: true, width: 120, sort: (e) => (e.hidden ? 0 : 1), csv: (e) => (e.hidden ? "hidden" : "shown"), cell: (e) => <GridSelect value={e.hidden ? "true" : "false"} options={[{ value: "false", label: "Shown" }, { value: "true", label: "Hidden" }]} ariaLabel={`${e.title} on the website`} onSave={save(e, "hidden")} /> },
      { id: "picture", header: "Picture", width: 150, sort: (e) => (e.imageUrl ? 1 : 0), csv: (e) => (e.imageUrl ? "yes" : ""), cell: (e) => <PictureCell row={e} /> },
      { id: "alt", header: "Picture description", edit: true, width: 200, sort: (e) => e.imageAlt ?? "", csv: (e) => e.imageAlt, cell: (e) => <GridCell grid="web-events" col="alt" value={e.imageAlt ?? ""} placeholder={e.imageUrl ? "What's in the picture" : "Add a picture first"} ariaLabel={`Picture description for ${e.title}`} onSave={save(e, "imageAlt")} /> },
      { id: "price", header: "Price", edit: true, width: 130, sort: (e) => e.priceLabel ?? "", csv: (e) => e.priceLabel, cell: (e) => <GridCell grid="web-events" col="price" value={e.priceLabel ?? ""} placeholder="e.g. Free" ariaLabel={`Price for ${e.title}`} onSave={save(e, "priceLabel")} /> },
      { id: "ticket", header: "Tickets link", edit: true, width: 200, sort: (e) => e.ticketUrl ?? "", csv: (e) => e.ticketUrl, cell: (e) => <GridCell grid="web-events" col="ticket" value={e.ticketUrl ?? ""} placeholder="https://…" ariaLabel={`Tickets link for ${e.title}`} onSave={save(e, "ticketUrl")} /> },
      { id: "rsvp", header: "RSVP link", edit: true, width: 200, defaultHidden: true, sort: (e) => e.rsvpUrl ?? "", csv: (e) => e.rsvpUrl, cell: (e) => <GridCell grid="web-events" col="rsvp" value={e.rsvpUrl ?? ""} placeholder="https://…" ariaLabel={`RSVP link for ${e.title}`} onSave={save(e, "rsvpUrl")} /> },
      { id: "featured", header: "Featured", edit: true, width: 110, sort: (e) => (e.featured ? 1 : 0), csv: (e) => (e.featured ? "yes" : ""), cell: (e) => <GridSelect value={e.featured ? "true" : "false"} options={[{ value: "false", label: "No" }, { value: "true", label: "Yes" }]} ariaLabel={`Feature ${e.title}`} onSave={save(e, "featured")} /> },
      { id: "kind", header: "Kind on the site", help: "website.events.kind", edit: true, width: 150, defaultHidden: true, sort: (e) => e.webKind ?? e.kind, csv: (e) => e.webKind ?? e.kind, cell: (e) => <GridSelect value={e.webKind ?? ""} options={[{ value: "", label: kindLabel(e.kind) }, { value: "TRIVIA", label: "Trivia" }, { value: "MOVIE", label: "Movie" }]} ariaLabel={`Kind on the website for ${e.title}`} onSave={save(e, "webKind")} /> },
      { id: "closed", header: "Closed that day", edit: true, width: 150, defaultHidden: true, sort: (e) => closedValue(e.closed), csv: (e) => closedValue(e.closed), cell: (e) => <GridSelect value={closedValue(e.closed)} options={[{ value: "", label: e.kind === "CLOSURE" ? "Closed (closure)" : e.kind === "HOLIDAY" ? "As holidays are" : "Open" }, { value: "closed", label: "Closed" }, { value: "open", label: "Open" }]} ariaLabel={`Closed on ${e.title}`} onSave={save(e, "closed")} /> },
      { id: "kitchen", header: "Kitchen closes", help: "website.events.late", edit: true, width: 120, defaultHidden: true, sort: (e) => e.kitchenCloseOverride ?? "", csv: (e) => e.kitchenCloseOverride, cell: (e) => <GridCell grid="web-events" col="kitchen" value={e.kitchenCloseOverride ? hhmmLabel(e.kitchenCloseOverride) : ""} placeholder="Usual" ariaLabel={`Kitchen closes on ${e.title}`} onSave={save(e, "kitchenCloseOverride")} /> },
      { id: "bar", header: "Bar closes", edit: true, width: 120, defaultHidden: true, sort: (e) => e.barCloseOverride ?? "", csv: (e) => e.barCloseOverride, cell: (e) => <GridCell grid="web-events" col="bar" value={e.barCloseOverride ? hhmmLabel(e.barCloseOverride) : ""} placeholder="Usual" ariaLabel={`Bar closes on ${e.title}`} onSave={save(e, "barCloseOverride")} /> },
      { id: "slug", header: "Web address", edit: true, width: 260, defaultHidden: true, sort: (e) => e.slug ?? "", csv: (e) => e.slug, cell: (e) => <GridCell grid="web-events" col="slug" value={e.slug ?? ""} placeholder="Set when the website first reads it" ariaLabel={`Web address for ${e.title}`} onSave={save(e, "slug")} /> },
    ],
    [],
  );
  const filters = useMemo<Filter<WebEventRow>[]>(
    () => [
      { id: "shown", label: "Shown", kind: "facet", single: true, display: "segmented", allLabel: "All", values: (e) => (e.hidden ? "hidden" : "shown"), options: [{ value: "shown", label: "Shown" }, { value: "hidden", label: "Hidden" }] },
      { id: "nopic", label: "No picture", kind: "toggle", tone: "warn", test: (e) => !e.hidden && !e.imageUrl && e.kind !== "CLOSURE" && e.kind !== "HOLIDAY" },
      { id: "closed", label: "Closed days", kind: "toggle", test: (e) => isClosedOnSite(e, hol) },
    ],
    [hol],
  );

  return (
    <>
      <HelpZone id="website.events" tour="website.events">
        <Section
          title="Events on the website"
          description="Every game, music night, holiday and closure from Events (private bookings never show). Add a picture, a price, a ticket link or a late close; everything else comes from the calendar."
          actions={<LinkButton href="/events" variant="ghost" size="sm" className="hidden sm:inline-flex">Calendar</LinkButton>}
        >
          <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 text-ink-2">Holidays <HelpTip id="website.events.holidays" /></span>
              <div role="radiogroup" aria-label="Holidays on the website" className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5">
                {[false, true].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={hol === v}
                    disabled={pending}
                    onClick={() => { setHol(v); start(async () => { await setHolidaysClosed(v); router.refresh(); }); }}
                    className={cx("inline-flex h-9 items-center rounded-md px-3 text-sm sm:h-8", hol === v ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}
                  >
                    {v ? "Mean closed" : "Stay open"}
                  </button>
                ))}
              </div>
            </div>
            <LinkButton href={past ? "/website/events" : "/website/events?past=1"} variant="ghost" size="sm" scroll={false}>{past ? "Hide past events" : "Show past events"}</LinkButton>
          </Card>
          <DataTable
            id="website-events"
            rows={rows}
            rowKey={(e) => e.id}
            columns={columns}
            noun={["event", "events"]}
            searchText={(e) => `${e.title} ${e.kind} ${e.date} ${e.priceLabel ?? ""}`}
            searchPlaceholder="Search events"
            filters={filters}
            urlSearch={false}
            csvName="website-events"
            help="website.events"
            rowClassName={(e) => (e.past ? "opacity-60" : undefined)}
            summary={(vis) => [
              { value: vis.length, label: vis.length === 1 ? "event" : "events" },
              { value: vis.filter((e) => isClosedOnSite(e, hol)).length, label: vis.filter((e) => isClosedOnSite(e, hol)).length === 1 ? "closed day" : "closed days", filter: { id: "closed" } },
              ...(vis.some((e) => !e.hidden && !e.imageUrl && e.kind !== "CLOSURE" && e.kind !== "HOLIDAY") ? [{ value: vis.filter((e) => !e.hidden && !e.imageUrl && e.kind !== "CLOSURE" && e.kind !== "HOLIDAY").length, label: "without a picture", tone: "warn" as const, filter: { id: "nopic" } }] : []),
            ]}
            card={(e) => ({
              title: e.title,
              subtitle: `${shortDate(e.date)}${timeText(e) ? ` · ${timeText(e)}` : ""}`,
              value: e.hidden ? <span className="text-xs text-muted">Hidden</span> : isClosedOnSite(e, hol) ? <Badge tone="warn">Closed</Badge> : e.featured ? <Badge>Featured</Badge> : undefined,
              sub: [e.priceLabel, e.imageUrl ? "Picture" : null].filter(Boolean).join(" · ") || undefined,
            })}
            drawerTitle={(e) => e.title}
            drawer={(e) => <EventDrawer e={e} />}
            empty={<p className="p-6 text-sm text-muted">No events in this window. Add them on Events.</p>}
          />
        </Section>
      </HelpZone>
    </>
  );
}

function EventDrawer({ e }: { e: WebEventRow }) {
  const save = (f: Parameters<typeof setEventWebField>[1]) => (v: string) => setEventWebField(e.id, f, v);
  return (
    <div className="divide-y divide-border">
      <DetailRow label="When">{shortDate(e.date)}{timeText(e) ? ` · ${timeText(e)}` : ""} · {kindLabel(e.kind)}</DetailRow>
      {e.notes && <DetailRow label="Description"><span className="text-sm text-ink-2">{e.notes}</span></DetailRow>}
      <DetailRow label="On the website"><GridSelect value={e.hidden ? "true" : "false"} options={[{ value: "false", label: "Shown" }, { value: "true", label: "Hidden" }]} ariaLabel="On the website" onSave={save("hidden")} /></DetailRow>
      <DetailRow label="Picture"><PictureCell row={e} /></DetailRow>
      <DetailRow label="Picture description"><GridCell grid="web-events-d" col="alt" value={e.imageAlt ?? ""} placeholder="What's in the picture" ariaLabel="Picture description" onSave={save("imageAlt")} /></DetailRow>
      <DetailRow label="Price"><GridCell grid="web-events-d" col="price" value={e.priceLabel ?? ""} placeholder="e.g. Free, $10 at the door" ariaLabel="Price" onSave={save("priceLabel")} /></DetailRow>
      <DetailRow label="Tickets link"><GridCell grid="web-events-d" col="ticket" value={e.ticketUrl ?? ""} placeholder="https://…" ariaLabel="Tickets link" onSave={save("ticketUrl")} /></DetailRow>
      <DetailRow label="RSVP link"><GridCell grid="web-events-d" col="rsvp" value={e.rsvpUrl ?? ""} placeholder="https://…" ariaLabel="RSVP link" onSave={save("rsvpUrl")} /></DetailRow>
      <DetailRow label="Featured"><GridSelect value={e.featured ? "true" : "false"} options={[{ value: "false", label: "No" }, { value: "true", label: "Yes" }]} ariaLabel="Featured" onSave={save("featured")} /></DetailRow>
      <DetailRow label="Kind on the site"><GridSelect value={e.webKind ?? ""} options={[{ value: "", label: kindLabel(e.kind) }, { value: "TRIVIA", label: "Trivia" }, { value: "MOVIE", label: "Movie" }]} ariaLabel="Kind on the website" onSave={save("webKind")} /></DetailRow>
      <DetailRow label="Closed that day"><GridSelect value={closedValue(e.closed)} options={[{ value: "", label: "As its kind" }, { value: "closed", label: "Closed" }, { value: "open", label: "Open" }]} ariaLabel="Closed that day" onSave={save("closed")} /></DetailRow>
      <DetailRow label="Kitchen closes"><GridCell grid="web-events-d" col="kitchen" value={e.kitchenCloseOverride ? hhmmLabel(e.kitchenCloseOverride) : ""} placeholder="Usual time" ariaLabel="Kitchen closes" onSave={save("kitchenCloseOverride")} /></DetailRow>
      <DetailRow label="Bar closes"><GridCell grid="web-events-d" col="bar" value={e.barCloseOverride ? hhmmLabel(e.barCloseOverride) : ""} placeholder="Usual time" ariaLabel="Bar closes" onSave={save("barCloseOverride")} /></DetailRow>
      <DetailRow label="Web address"><GridCell grid="web-events-d" col="slug" value={e.slug ?? ""} placeholder="Set when the website first reads it" ariaLabel="Web address" onSave={save("slug")} /></DetailRow>
    </div>
  );
}
