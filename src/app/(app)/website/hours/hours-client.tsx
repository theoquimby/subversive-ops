"use client";

import { GridCell } from "@/components/grid";
import { HelpTip, HelpZone } from "@/components/help";
import { Button, Card, DatePicker, Dot, Field, LinkButton, Section, Table, Td, Textarea, Th, Tr, cx } from "@/components/ui";
import { dayLabel, dayWindowLabel, type ShowState } from "@/domain/showWindow";
import { DOW_OF_WEEKDAY, dayRangeLabel, hhmmLabel, NOTICE_MAX, type ExactHours, type StoredNotice } from "@/domain/websiteHours";
import { rangeLabel, type WeekHours } from "@/domain/openingHours";
import { LINK_LABEL, parseAddress, parsePhone, type WebLinks } from "@/domain/websiteContact";
import { LINK_KEYS, WEEKDAYS, type SiteFeed, type Weekday } from "@/domain/websiteSchema";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveExactTime, saveLink, saveNotice, savePhoneNote } from "../actions";

const DAY_NAME: Record<Weekday, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export function HoursTab(p: {
  feed: SiteFeed;
  stale: Partial<Record<Weekday, ("open" | "close" | "kitchenClose")[]>>;
  regular: WeekHours;
  seasons: { label: string; from: string; to: string }[];
  settings: { notice: StoredNotice | null; exactHours: ExactHours; links: WebLinks; phoneNote: string };
  contact: { name: string; address: string; phone: string; email: string; website: string };
  today: string;
}) {
  return (
    <>
      <HelpZone id="website.notice" tour="website.notice">
        <Section title="Notice" description="One line at the top of the website for anything guests should know: a closure, a change of hours, a special night. Write it ahead and pick the day it starts; it comes down by itself after its last day.">
          <NoticeEditor initial={p.settings.notice} today={p.today} />
        </Section>
      </HelpZone>

      <HelpZone id="website.hours" tour="website.hours">
        <Section
          title="Hours on the website"
          description={<>Opening hours come from <Link href="/settings/business#hours" className="text-ink underline underline-offset-2">Settings → Business</Link> in whole hours. Add the exact minute and when the kitchen closes here.{p.feed.season ? ` ${p.feed.season} hours are in force now.` : ""}</>}
          actions={<LinkButton href="/settings/business#hours" variant="ghost" size="sm" className="hidden sm:inline-flex">Opening hours <ChevronRight className="size-4" /></LinkButton>}
        >
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th>Opens</Th>
                <Th>Closes</Th>
                <Th><span className="inline-flex items-center gap-1">Kitchen <HelpTip id="website.kitchenClose" /></span></Th>
                <Th className="hidden md:table-cell">On the website</Th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((d) => {
                const ops = p.regular[DOW_OF_WEEKDAY[d]];
                const ex = p.settings.exactHours[d] ?? {};
                const st = p.stale[d] ?? [];
                const web = p.feed.hours[d];
                return (
                  <Tr key={d}>
                    <Td className="py-2">
                      <div className="font-medium"><span className="sm:hidden">{DAY_NAME[d].slice(0, 3)}</span><span className="hidden sm:inline">{DAY_NAME[d]}</span></div>
                      <div className="text-xs text-muted">{ops ? rangeLabel(ops) : "Closed"}</div>
                    </Td>
                    {ops ? (
                      (["open", "close", "kitchenClose"] as const).map((f) => (
                        <Td key={f} className="px-1 py-1.5">
                          <GridCell grid="web-hours" col={f} value={ex[f] ? hhmmLabel(ex[f]!) : ""} placeholder={web ? hhmmLabel(web[f]) : "—"} ariaLabel={`${DAY_NAME[d]} ${f === "kitchenClose" ? "kitchen closes" : f === "open" ? "opens" : "closes"}`} onSave={(v) => saveExactTime(d, f, v)} className="min-w-[4.5rem]" />
                          {st.includes(f) && <div className="px-2 text-[0.7rem] text-warn">Doesn&apos;t fit, ignored</div>}
                        </Td>
                      ))
                    ) : (
                      <Td colSpan={3} className="text-sm text-muted">Closed all day</Td>
                    )}
                    <Td className="hidden text-sm md:table-cell">
                      {web ? <span className="num">{dayRangeLabel(web)}{web.kitchenClose !== web.close && <span className="text-muted"> · kitchen {hhmmLabel(web.kitchenClose)}</span>}</span> : <span className="text-muted">Closed</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-muted">Type a time like 4:30pm. Leave a cell empty to use the whole hour. One-off late nights and closures go on Events.</p>
          {p.seasons.length > 0 && <p className="mt-1 text-xs text-muted">Seasons ({p.seasons.map((s) => s.label).join(", ")}) use the same exact times wherever they fit.</p>}
        </Section>
      </HelpZone>

      <HelpZone id="website.contact">
        <Section title="Contact and links" description="Name, address, phone and email come from Settings → Business. Links to ordering, gift cards and social pages are set here.">
          <div className="grid gap-4 lg:grid-cols-2">
            <ContactCard contact={p.contact} feed={p.feed} phoneNote={p.settings.phoneNote} />
            <Card className="divide-y divide-border">
              {LINK_KEYS.map((k) => (
                <div key={k} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 px-3 py-1.5 sm:grid-cols-[9rem_1fr]">
                  <span className="text-sm text-ink-2">{LINK_LABEL[k]}</span>
                  <GridCell grid="web-links" col="url" value={p.settings.links[k] ?? ""} placeholder="https://…" ariaLabel={LINK_LABEL[k]} onSave={(v) => saveLink(k, v)} />
                </div>
              ))}
            </Card>
          </div>
        </Section>
      </HelpZone>
    </>
  );
}

function ContactCard({ contact, feed, phoneNote }: { contact: { name: string; address: string; phone: string; email: string }; feed: SiteFeed; phoneNote: string }) {
  const addr = parseAddress(contact.address);
  const phone = parsePhone(contact.phone);
  const line = (label: string, value: string, ok: boolean, problem: string) => (
    <div className="grid grid-cols-[5rem_1fr] gap-2 px-3 py-2.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words">{value || <span className="text-muted">Not set</span>}{value && !ok && <span className="block text-xs text-warn">{problem}</span>}</span>
    </div>
  );
  return (
    <Card className="divide-y divide-border">
      {line("Name", contact.name, !!feed.name, "")}
      {line("Address", contact.address, !!addr, "Write it as street, town, state zip. The website keeps its own until then")}
      {line("Phone", contact.phone, !!phone, "Not a US number the website can call")}
      <div className="grid grid-cols-[5rem_1fr] items-center gap-2 px-3 py-1.5 text-sm">
        <span className="text-muted">Phone note</span>
        <GridCell grid="web-contact" col="note" value={phoneNote} placeholder="e.g. Only answered during taproom hours." ariaLabel="Phone note" onSave={savePhoneNote} />
      </div>
      {line("Email", contact.email, !!feed.email, "That email address doesn't look right")}
      <div className="px-3 py-2.5">
        <LinkButton href="/settings/business" variant="ghost" size="sm" className="-ml-2">Edit in Settings → Business <ChevronRight className="size-4" /></LinkButton>
      </div>
    </Card>
  );
}

const STATE_TONE: Record<ShowState, "good" | "neutral" | "warn"> = { showing: "good", scheduled: "neutral", ended: "warn" };

function NoticeEditor({ initial, today }: { initial: StoredNotice | null; today: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial?.text ?? "");
  // A start day that has come is the same as no start: it's showing.
  const savedFrom = initial?.from && initial.from > today ? initial.from : "";
  const [from, setFrom] = useState(savedFrom);
  const [until, setUntil] = useState(initial?.until ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = text.trim() !== (initial?.text ?? "") || from !== savedFrom || until !== (initial?.until ?? "");
  const status = initial ? dayWindowLabel(initial.from, initial.until, today) : null;
  const later = !!from && from > today;
  const backwards = !!from && !!until && from > until;
  const edit = (f: () => void) => { f(); setSaved(null); setError(null); };
  const save = (t: string, f: string, u: string) =>
    start(async () => {
      setError(null);
      const r = await saveNotice({ text: t, from: f || null, until: u || null });
      if (r.error) setError(r.error);
      else {
        if (f && f <= today) setFrom(""); // saved as "right away"
        setSaved(!t.trim() ? "Removed from the website." : f && f > today ? `Scheduled. The website shows it from ${dayLabel(f, today)}.` : "Saved. The website shows it within a minute.");
        router.refresh();
      }
    });
  return (
    <Card className="p-4">
      <Field label="What guests should know" hint={<span className={cx("num", text.length > NOTICE_MAX && "text-bad")}>{text.length}/{NOTICE_MAX}</span>}>
        <Textarea value={text} onChange={(e) => edit(() => setText(e.target.value))} rows={2} maxLength={NOTICE_MAX + 40} placeholder="Closed Thursday for Thanksgiving. Back Friday at 4:30." data-tour="website.notice-text" />
      </Field>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 md:max-w-xl">
        <div>
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Start showing</span>
          <DatePicker value={from} onChange={(e) => edit(() => setFrom(e.target.value))} min={today} max={until || undefined} today={today} aria-label="First day the notice shows" />
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            {from ? <button type="button" className="min-h-6 underline underline-offset-2" onClick={() => edit(() => setFrom(""))}>Show it right away</button> : "Leave empty to show it as soon as you publish"}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Last day it shows</span>
          <DatePicker value={until} onChange={(e) => edit(() => setUntil(e.target.value))} min={from && from > today ? from : today} today={today} aria-label="Last day the notice shows" />
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            {until ? <button type="button" className="min-h-6 underline underline-offset-2" onClick={() => edit(() => setUntil(""))}>No end date</button> : "Leave empty to keep it up until you remove it"}
          </div>
        </div>
      </div>
      {status && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          <Dot tone={STATE_TONE[status.state]} />
          <span className={cx(status.state === "ended" ? "text-warn" : "text-ink")}>{status.label}</span>
          {status.state === "ended" && initial?.until && <span className="text-muted">· last day was {dayLabel(initial.until, today)}, so it isn&apos;t showing</span>}
        </p>
      )}
      {backwards && <p className="mt-3 text-sm text-bad">It would start after its last day. Pick a start on or before the last day.</p>}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      {saved && !dirty && <p className="mt-3 text-sm text-good">{saved}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={pending || !dirty || !text.trim() || backwards} onClick={() => save(text, from, until)}>{pending ? "Saving…" : later ? "Schedule notice" : "Publish notice"}</Button>
        {initial && <Button variant="ghost" disabled={pending} onClick={() => { setText(""); setFrom(""); setUntil(""); save("", "", ""); }}>Take it down</Button>}
      </div>
    </Card>
  );
}
