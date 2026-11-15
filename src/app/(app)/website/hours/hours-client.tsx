"use client";

import { GridCell } from "@/components/grid";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, DatePicker, Field, LinkButton, Section, Table, Td, Textarea, Th, Tr, cx } from "@/components/ui";
import { DOW_OF_WEEKDAY, dayRangeLabel, hhmmLabel, NOTICE_MAX, type ExactHours, type SiteNotice } from "@/domain/websiteHours";
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
  settings: { notice: SiteNotice | null; exactHours: ExactHours; links: WebLinks; phoneNote: string };
  contact: { name: string; address: string; phone: string; email: string; website: string };
  today: string;
}) {
  return (
    <>
      <HelpZone id="website.notice" tour="website.notice">
        <Section title="Notice" description="One line at the top of the website for anything guests should know: a closure, a change of hours, a special night. It comes down by itself after its last day.">
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
      {line("Address", contact.address, !!addr, "Write it as street, town, state zip — the website keeps its own until then")}
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

function NoticeEditor({ initial, today }: { initial: SiteNotice | null; today: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial?.text ?? "");
  const [until, setUntil] = useState(initial?.until ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = text.trim() !== (initial?.text ?? "") || until !== (initial?.until ?? "");
  const expired = !!initial?.until && initial.until < today;
  const save = (t: string, u: string) =>
    start(async () => {
      setError(null);
      const r = await saveNotice({ text: t, until: u || null });
      if (r.error) setError(r.error);
      else {
        setSaved(t.trim() ? "Saved. The website shows it within a minute." : "Removed from the website.");
        router.refresh();
      }
    });
  return (
    <Card className="p-4">
      <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
        <Field label="What guests should know" hint={<span className={cx("num", text.length > NOTICE_MAX && "text-bad")}>{text.length}/{NOTICE_MAX}</span>}>
          <Textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(null); }} rows={2} maxLength={NOTICE_MAX + 40} placeholder="Closed Thursday for Thanksgiving. Back Friday at 4:30." data-tour="website.notice-text" />
        </Field>
        <div>
          <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Last day it shows</span>
          <DatePicker value={until} onChange={(e) => { setUntil(e.target.value); setSaved(null); }} min={today} today={today} aria-label="Last day the notice shows" />
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            {until ? <button type="button" className="underline underline-offset-2" onClick={() => setUntil("")}>No end date</button> : "Leave empty to keep it up until you remove it"}
          </div>
        </div>
      </div>
      {expired && <p className="mt-3 text-sm text-warn">This notice ended {initial!.until} and isn&apos;t showing.</p>}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      {saved && !dirty && <p className="mt-3 text-sm text-good">{saved}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={pending || !dirty || !text.trim()} onClick={() => save(text, until)}>{pending ? "Saving…" : initial ? "Save notice" : "Publish notice"}</Button>
        {initial && <Button variant="ghost" disabled={pending} onClick={() => { setText(""); setUntil(""); save("", ""); }}>Take it down</Button>}
        {initial && !expired && <Badge tone="good">Live</Badge>}
      </div>
    </Card>
  );
}
