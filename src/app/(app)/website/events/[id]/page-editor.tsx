"use client";

import { useConfirm } from "@/components/dialog";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, Field, Input, LinkButton, Section, Textarea } from "@/components/ui";
import { EVENT_PAGE_LIMITS as L, heroProblem, paragraphs } from "@/domain/websiteEventPage";
import { hhmmLabel } from "@/domain/websiteHours";
import { dayDate } from "@/lib/format";
import { ArrowDown, ArrowLeft, ArrowUp, ImageUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import type { EventPageEditor } from "@/server/services/websiteEventPages";
import { deleteEventHero, saveEventPage, uploadEventHero, type EventPageForm } from "./actions";

type Sec = { title: string; body: string };
type Row = { time: string; what: string };
type Lnk = { label: string; href: string };

/** Shrink to at most 2000 px wide (never below the 1600 the website needs), as WebP or JPEG. */
async function shrinkHero(file: File): Promise<{ file: File } | { error: string }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { error: "Couldn't read that photo. Try a JPEG or PNG." };
  }
  const problem = heroProblem(bmp.width, bmp.height);
  if (problem) return { error: problem };
  const s = Math.min(1, 2000 / bmp.width);
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.82, 0.7, 0.6]) {
    const webp = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", q));
    const out = webp && webp.type === "image/webp" ? webp : await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));
    if (!out) break;
    if (out.size <= 1_450_000) return { file: new File([out], out.type === "image/webp" ? "hero.webp" : "hero.jpg", { type: out.type }) };
  }
  return { error: "Couldn't make that photo small enough. Try another." };
}

const count = (n: number, max: number) => <span className={cx("num", n > max && "text-bad")}>{n}/{max}</span>;
const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

function RowTools({ i, n, label, onMove, onRemove }: { i: number; n: number; label: string; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 items-center">
      <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
      <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`Move ${label} down`} disabled={i === n - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
      <Button size="sm" variant="ghost" className="size-10 p-0 text-muted hover:text-bad sm:size-8" aria-label={`Remove ${label}`} onClick={onRemove}><Trash2 className="size-4" /></Button>
    </div>
  );
}

export function EventPageEditorView({ e, siteUrl }: { e: EventPageEditor; siteUrl: string | null }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [intro, setIntro] = useState(e.content.intro ?? "");
  const [heroAlt, setHeroAlt] = useState(e.heroAlt ?? "");
  const [sections, setSections] = useState<Sec[]>(e.content.sections);
  const [schedule, setSchedule] = useState<Row[]>(e.content.schedule);
  const [links, setLinks] = useState<Lnk[]>(e.content.links);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [heroPending, startHero] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
    setSaved(null);
  };
  const setI = touch(setIntro);
  const setA = touch(setHeroAlt);
  const setS = touch(setSections);
  const setR = touch(setSchedule);
  const setL = touch(setLinks);

  const form: EventPageForm = { intro, heroAlt, sections, schedule, links };
  const save = () => {
    setErrors([]);
    start(async () => {
      const r = await saveEventPage(e.eventId, form);
      if (r.errors?.length) setErrors(r.errors);
      else if (r.error) setErrors([r.error]);
      else {
        setDirty(false);
        setSaved("Saved. The website shows it within a minute.");
        router.refresh();
      }
    });
  };

  const pickHero = (f: File | undefined) => {
    if (!f) return;
    setHeroError(null);
    startHero(async () => {
      const small = await shrinkHero(f);
      if ("error" in small) setHeroError(small.error);
      else {
        const fd = new FormData();
        fd.set("eventId", e.eventId);
        fd.set("file", small.file);
        const r = await uploadEventHero(fd);
        if (r.error) setHeroError(r.error);
        else router.refresh();
      }
      if (fileInput.current) fileInput.current.value = "";
    });
  };
  const removeHero = async () => {
    if (!(await confirm({ title: "Remove the photo?", body: "The page shows without a photo at the top.", confirmLabel: "Remove", danger: true }))) return;
    startHero(async () => {
      await deleteEventHero(e.eventId);
      router.refresh();
    });
  };

  const when = `${dayDate(e.date)}${e.startTime ? ` · ${hhmmLabel(e.startTime)}${e.endTime ? `–${hhmmLabel(e.endTime)}` : ""}` : ""}`;
  const address = siteUrl ? `${siteUrl}/events/${e.slug}` : `/events/${e.slug}`;

  return (
    <HelpZone id="website.events.page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <LinkButton href="/website/events" variant="ghost" size="sm"><ArrowLeft className="size-4" />Events</LinkButton>
        <div role="radiogroup" aria-label="Edit or preview" className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5">
          {(["edit", "preview"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cx("inline-flex h-10 items-center rounded-md px-4 text-sm sm:h-8", view === v ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>{v === "edit" ? "Edit" : "Preview"}</button>
          ))}
        </div>
      </div>

      <Section
        title={<span className="inline-flex items-center gap-2">{e.title}{e.hidden ? <Badge tone="warn">Hidden on the website</Badge> : e.featured ? <Badge>Featured</Badge> : null}</span>}
        description={<>{when}. Its page on the website: <span className="break-all">{address}</span>. What you add here shows below the usual top part (date, time, description).</>}
        help="website.events.page"
      >
        {view === "preview" ? (
          <Preview e={e} intro={intro} heroAlt={heroAlt} sections={sections} schedule={schedule} links={links} when={when} />
        ) : (
          <div className="max-w-3xl space-y-6">
            <Block title="Photo at the top" help="website.events.page.photo">
              {e.heroUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.heroUrl} alt={heroAlt || e.title} className="aspect-[16/9] w-full rounded-lg object-cover ring-1 ring-border" />
              ) : (
                <div className="grid aspect-[16/9] w-full place-items-center rounded-lg bg-surface-2 p-4 text-center text-sm text-muted ring-1 ring-border ring-inset">A landscape photo, at least 1600 px wide</div>
              )}
              {e.heroSize && <p className="num mt-1 text-xs text-muted">{e.heroSize.width} × {e.heroSize.height} px</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={heroPending} onClick={() => fileInput.current?.click()}><ImageUp className="size-4" />{heroPending ? "Uploading…" : e.heroUrl ? "Replace photo" : "Upload photo"}</Button>
                {e.heroUrl && <Button size="sm" variant="danger" disabled={heroPending} onClick={removeHero}><Trash2 className="size-4" />Remove</Button>}
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(ev) => pickHero(ev.target.files?.[0])} />
              </div>
              {heroError && <p className="mt-2 text-sm text-bad" role="alert">{heroError}</p>}
              <Field className="mt-3" label="What's in the photo" hint={<>{count(heroAlt.trim().length, L.heroAlt)} · read aloud to people who can't see it; empty uses the event's name</>}>
                <Input value={heroAlt} onChange={(ev) => setA(ev.target.value)} placeholder="The long tables in the yard" />
              </Field>
            </Block>

            <Block title="Intro">
              <Field label="A few sentences under the photo" hint={count(intro.trim().length, L.intro)}>
                <Textarea rows={3} value={intro} onChange={(ev) => setI(ev.target.value)} placeholder="Two days in the yard: Festbier, brats and an oompah band." />
              </Field>
            </Block>

            <Block title={`Sections (${sections.length} of ${L.sections})`}>
              <div className="space-y-3">
                {sections.map((s, i) => (
                  <Card key={i} className="space-y-2 p-3">
                    <div className="flex items-start gap-2">
                      <Field className="min-w-0 flex-1" label={`Heading ${i + 1}`} hint={count(s.title.trim().length, L.sectionTitle)}>
                        <Input value={s.title} onChange={(ev) => setS(sections.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))} placeholder="Food" />
                      </Field>
                      <div className="pt-6"><RowTools i={i} n={sections.length} label={`section ${i + 1}`} onMove={(d) => setS(move(sections, i, d))} onRemove={() => setS(sections.filter((_, j) => j !== i))} /></div>
                    </div>
                    <Field label="Words" hint={<>{count(s.body.trim().length, L.sectionBody)} · leave a blank line between paragraphs</>}>
                      <Textarea rows={5} value={s.body} onChange={(ev) => setS(sections.map((x, j) => (j === i ? { ...x, body: ev.target.value } : x)))} />
                    </Field>
                  </Card>
                ))}
                <Button size="sm" disabled={sections.length >= L.sections} onClick={() => setS([...sections, { title: "", body: "" }])}><Plus className="size-4" />Add a section</Button>
              </div>
            </Block>

            <Block title={`Schedule (${schedule.length} of ${L.schedule})`} hint="Any wording for the time: 12:00, Noon, All day.">
              <div className="space-y-2">
                {schedule.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input className="w-24 shrink-0 sm:w-28" value={r.time} onChange={(ev) => setR(schedule.map((x, j) => (j === i ? { ...x, time: ev.target.value } : x)))} placeholder="12:00" aria-label={`Time, row ${i + 1}`} maxLength={40} />
                    <Input className="min-w-0 flex-1" value={r.what} onChange={(ev) => setR(schedule.map((x, j) => (j === i ? { ...x, what: ev.target.value } : x)))} placeholder="First pour" aria-label={`What happens, row ${i + 1}`} />
                    <RowTools i={i} n={schedule.length} label={`row ${i + 1}`} onMove={(d) => setR(move(schedule, i, d))} onRemove={() => setR(schedule.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <Button size="sm" disabled={schedule.length >= L.schedule} onClick={() => setR([...schedule, { time: "", what: "" }])}><Plus className="size-4" />Add a row</Button>
              </div>
            </Block>

            <Block title={`Links (${links.length} of ${L.links})`} hint="Tickets, the band's page, a map. https:// addresses only.">
              <div className="space-y-2">
                {links.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <Input className="w-full sm:w-40 sm:shrink-0" value={l.label} onChange={(ev) => setL(links.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} placeholder="Tickets" aria-label={`Link words, link ${i + 1}`} />
                    <Input className="min-w-0 flex-1" value={l.href} onChange={(ev) => setL(links.map((x, j) => (j === i ? { ...x, href: ev.target.value } : x)))} placeholder="https://…" inputMode="url" aria-label={`Address, link ${i + 1}`} />
                    <RowTools i={i} n={links.length} label={`link ${i + 1}`} onMove={(d) => setL(move(links, i, d))} onRemove={() => setL(links.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <Button size="sm" disabled={links.length >= L.links} onClick={() => setL([...links, { label: "", href: "" }])}><Plus className="size-4" />Add a link</Button>
              </div>
            </Block>
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          {errors.length > 0 && (
            <ul className="mb-2 space-y-0.5 text-sm text-bad" role="alert">
              {errors.map((x) => <li key={x}>{x}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : "Save page"}</Button>
            <span className="text-sm text-muted" role="status">{saved ?? (dirty ? "Not saved yet" : "Photo changes save as soon as they upload")}</span>
          </div>
        </div>
      </Section>
    </HelpZone>
  );
}

function Block({ title, hint, help, children }: { title: string; hint?: string; help?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-1 text-sm font-semibold">{title}{help && <HelpTip id={help} />}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Roughly how the website draws the event's page (website src/components/events/EventFeature.tsx). */
function Preview({ e, intro, heroAlt, sections, schedule, links, when }: { e: EventPageEditor; intro: string; heroAlt: string; sections: Sec[]; schedule: Row[]; links: Lnk[]; when: string }) {
  const secs = sections.filter((s) => s.title.trim() || s.body.trim());
  const rows = schedule.filter((r) => r.time.trim() || r.what.trim());
  const lnks = links.filter((l) => l.label.trim() || l.href.trim());
  const empty = !e.heroUrl && !intro.trim() && !secs.length && !rows.length && !lnks.length;
  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-xl bg-[#f7f3ea] text-[#151412] ring-1 ring-border">
      <div className="px-4 pt-6 pb-4 sm:px-8">
        <p className="text-xs font-semibold tracking-wider uppercase opacity-70">{when}</p>
        <h2 className="mt-1 text-2xl leading-tight font-bold sm:text-3xl">{e.title}</h2>
        {e.notes && <p className="mt-2 text-[0.95rem] opacity-80">{e.notes}</p>}
      </div>
      {empty ? (
        <p className="border-t border-black/10 px-4 py-6 text-sm opacity-70 sm:px-8">Nothing more yet: without a page the website shows just the part above.</p>
      ) : (
        <div className="space-y-6 border-t border-black/10 pb-8">
          {e.heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.heroUrl} alt={heroAlt || e.title} className="aspect-[16/9] w-full object-cover" />
          )}
          <div className="space-y-6 px-4 sm:px-8">
            {intro.trim() && <p className="text-lg leading-snug">{intro.trim()}</p>}
            {secs.map((s, i) => (
              <section key={i}>
                <h3 className="border-b-2 border-[#151412] pb-1 text-sm font-bold tracking-wider uppercase">{s.title || "Heading"}</h3>
                <div className="mt-2 space-y-3 text-[0.95rem] leading-relaxed">
                  {paragraphs(s.body).map((p, j) => <p key={j} className="whitespace-pre-line">{p}</p>)}
                </div>
              </section>
            ))}
            {rows.length > 0 && (
              <section>
                <h3 className="border-b-2 border-[#151412] pb-1 text-sm font-bold tracking-wider uppercase">Schedule</h3>
                <ol className="mt-2 divide-y divide-black/10">
                  {rows.map((r, i) => (
                    <li key={i} className="flex gap-4 py-2 text-[0.95rem]">
                      <span className="num w-20 shrink-0 font-semibold">{r.time}</span>
                      <span>{r.what}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {lnks.length > 0 && (
              <section>
                <h3 className="border-b-2 border-[#151412] pb-1 text-sm font-bold tracking-wider uppercase">Links</h3>
                <ul className="mt-2 space-y-1.5">
                  {lnks.map((l, i) => <li key={i} className="font-semibold underline underline-offset-2">{l.label || l.href} ↗</li>)}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
      <p className="border-t border-black/10 bg-white/50 px-4 py-2 text-xs opacity-70 sm:px-8">A rough preview. The website uses its own fonts and colours.</p>
    </div>
  );
}
