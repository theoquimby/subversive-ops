"use client";

import { Switch } from "@/components/push-toggle";
import { Select } from "@/components/select";
import { Button, Input } from "@/components/ui";
import { useConfirm } from "@/components/dialog";
import { DAY_NAMES, describeWeek, hourLabel, monthDayLabel, seasonProblem, WEEK_ORDER, type SeasonalHours, type WeekHours } from "@/domain/openingHours";
import { cn } from "@/lib/cn";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { AutoInput, SaveStatus } from "../controls";
import { deleteSeason, saveContact, saveHours, saveSeason, saveWeatherLocation, searchTown } from "../setting-actions";

type Status = "idle" | "saving" | "saved" | "error";

// ---- Contact -----------------------------------------------------------------------------

export function ContactField({ field, value, label, placeholder, type, autoComplete }: { field: "name" | "address" | "phone" | "email" | "website"; value: string; label: string; placeholder?: string; type?: "text" | "email" | "url" | "tel"; autoComplete?: string }) {
  return <AutoInput value={value} ariaLabel={label} placeholder={placeholder} type={type} autoComplete={autoComplete} className="w-full sm:w-80" onSave={(v) => saveContact(field, v)} />;
}

// ---- A week of hours ----------------------------------------------------------------------

const OPEN = Array.from({ length: 19 }, (_, i) => i + 5).map((h) => ({ value: String(h), label: hourLabel(h) }));
const CLOSE = Array.from({ length: 19 }, (_, i) => i + 6).map((h) => ({ value: String(h), label: hourLabel(h) }));

/** Seven rows: open/closed switch and from–to. Calls onChange with the whole week. */
function WeekEditor({ hours, onChange, idPrefix }: { hours: WeekHours; onChange: (next: WeekHours) => void; idPrefix: string }) {
  const [last, setLast] = useState<WeekHours>(hours);
  const set = (d: number, h: [number, number] | null) => {
    const next = { ...hours };
    if (h) next[d] = h;
    else {
      setLast((l) => ({ ...l, [d]: hours[d] }));
      delete next[d];
    }
    onChange(next);
  };
  return (
    <div className="divide-y divide-border">
      {WEEK_ORDER.map((d) => {
        const h = hours[d];
        return (
          <div key={d} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:grid-cols-[8rem_7rem_1fr] sm:px-5">
            <div className="text-sm font-medium text-ink">{DAY_NAMES[d]}</div>
            <div className="flex items-center gap-2 justify-self-end sm:justify-self-start">
              <span className={cn("text-sm", h ? "text-ink" : "text-muted")}>{h ? "Open" : "Closed"}</span>
              <Switch on={!!h} label={`${DAY_NAMES[d]} open`} onChange={(on) => set(d, on ? last[d] ?? [16, 21] : null)} />
            </div>
            {h ? (
              <div className="col-span-2 flex items-center gap-2 sm:col-span-1" id={`${idPrefix}-${d}`}>
                <Select value={String(h[0])} options={OPEN} aria-label={`${DAY_NAMES[d]} opens`} className="w-28" onChange={(e) => { const o = Number(e.target.value); set(d, [o, Math.max(h[1], o + 1)]); }} />
                <span className="text-sm text-muted">to</span>
                <Select value={String(h[1])} options={CLOSE.filter((c) => Number(c.value) > h[0])} aria-label={`${DAY_NAMES[d]} closes`} className="w-28" onChange={(e) => set(d, [h[0], Number(e.target.value)])} />
              </div>
            ) : <div className="hidden sm:block" />}
          </div>
        );
      })}
    </div>
  );
}

function useStatus() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setStatus("saving");
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); setStatus("error"); }
      else { setError(null); setStatus("saved"); after?.(); setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800); }
    });
  };
  return { status, error, run };
}

export function HoursEditor({ initial }: { initial: WeekHours }) {
  const [hours, setHours] = useState(initial);
  const { status, error, run } = useStatus();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <p className="num text-[0.8rem] text-ink-2">{describeWeek(hours)}</p>
        <SaveStatus status={status} error={error} />
      </div>
      <WeekEditor idPrefix="hours" hours={hours} onChange={(next) => { setHours(next); run(() => saveHours(next)); }} />
    </>
  );
}

// ---- Seasons ---------------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n: number) => String(n).padStart(2, "0");

function MonthDayPicker({ value, onChange, label }: { value: string; onChange: (md: string) => void; label: string }) {
  const m = Number(value.slice(0, 2)) || 1;
  const d = Number(value.slice(3)) || 1;
  return (
    <div className="flex items-center gap-2">
      <Select value={String(m)} aria-label={`${label} month`} className="w-36" options={MONTHS.map((n, i) => ({ value: String(i + 1), label: n }))} onChange={(e) => { const nm = Number(e.target.value); onChange(`${pad(nm)}-${pad(Math.min(d, DAYS_IN[nm - 1]))}`); }} />
      <Select value={String(d)} aria-label={`${label} day`} className="w-20" options={Array.from({ length: DAYS_IN[m - 1] }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={(e) => onChange(`${pad(m)}-${pad(Number(e.target.value))}`)} />
    </div>
  );
}

function SeasonCard({ season, onSaved, onRemoved, isNew }: { season: SeasonalHours; onSaved: (s: SeasonalHours) => void; onRemoved: () => void; isNew?: boolean }) {
  const [s, setS] = useState(season);
  const { status, error, run } = useStatus();
  const confirm = useConfirm();
  const [, start] = useTransition();
  const problem = seasonProblem(s);
  const save = (next: SeasonalHours) => {
    setS(next);
    if (isNew) return; // a new season saves with its Add button
    if (!seasonProblem(next)) run(() => saveSeason(next), () => onSaved(next));
  };
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:px-5">
        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Name</span>
            <Input value={s.label} maxLength={40} placeholder="Summer" aria-label="Season name" className="w-full sm:w-60" onChange={(e) => setS({ ...s, label: e.target.value })} onBlur={() => save(s)} />
          </label>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div><span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">From</span><MonthDayPicker label="From" value={s.from} onChange={(from) => save({ ...s, from })} /></div>
            <div><span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">To (including)</span><MonthDayPicker label="To" value={s.to} onChange={(to) => save({ ...s, to })} /></div>
          </div>
          <p className="text-xs text-muted">{monthDayLabel(s.from)} to {monthDayLabel(s.to)} every year · {describeWeek(s.hours)}</p>
        </div>
        <div className="flex items-start gap-2 sm:flex-col sm:items-end">
          <SaveStatus status={status} error={error ?? (isNew ? null : problem)} />
          {!isNew && (
            <Button size="sm" variant="ghost" onClick={async () => {
              if (await confirm({ title: `Remove ${s.label || "this season"}?`, body: "Those dates go back to your regular hours.", confirmLabel: "Remove", danger: true })) start(async () => { await deleteSeason(s.id); onRemoved(); });
            }}><Trash2 className="size-4" />Remove</Button>
          )}
        </div>
      </div>
      <div className="mx-4 mb-4 overflow-hidden rounded-lg border border-border sm:mx-5">
        <WeekEditor idPrefix={`season-${s.id}`} hours={s.hours} onChange={(hours) => save({ ...s, hours })} />
      </div>
      {isNew && (
        <div className="flex flex-wrap items-center gap-3 px-4 pb-4 sm:px-5">
          <Button variant="primary" disabled={!!problem || status === "saving"} onClick={() => run(async () => { const r = await saveSeason({ ...s, id: undefined }); if (!r.error && r.id) onSaved({ ...s, id: r.id }); return r; })}>Add season</Button>
          <Button variant="ghost" onClick={onRemoved}>Cancel</Button>
          <span className="text-xs text-muted">{problem ?? `Uses these hours from ${monthDayLabel(s.from)} to ${monthDayLabel(s.to)}.`}</span>
          <SaveStatus status={status} error={error} />
        </div>
      )}
    </div>
  );
}

export function SeasonsEditor({ initial, regular }: { initial: SeasonalHours[]; regular: WeekHours }) {
  const [seasons, setSeasons] = useState(initial);
  const [draft, setDraft] = useState<SeasonalHours | null>(null);
  return (
    <>
      {seasons.length === 0 && !draft && <p className="px-4 py-4 text-sm text-muted sm:px-5">No seasonal hours — your regular hours apply all year.</p>}
      {seasons.map((s) => (
        <SeasonCard key={s.id} season={s} onSaved={(n) => setSeasons((all) => all.map((x) => (x.id === n.id ? n : x)))} onRemoved={() => setSeasons((all) => all.filter((x) => x.id !== s.id))} />
      ))}
      {draft && <SeasonCard key="new" isNew season={draft} onSaved={(n) => { setSeasons((all) => [...all, n]); setDraft(null); }} onRemoved={() => setDraft(null)} />}
      {!draft && seasons.length < 6 && (
        <div className="border-t border-border px-4 py-3 first:border-t-0 sm:px-5">
          <Button size="sm" onClick={() => setDraft({ id: "new", label: "Summer", from: "06-01", to: "09-07", hours: { ...regular } })}><Plus className="size-4" />Add seasonal hours</Button>
        </div>
      )}
    </>
  );
}

// ---- Weather location ----------------------------------------------------------------------------

export function WeatherLocationEditor({ initial }: { initial: { lat: number; lon: number; label: string } }) {
  const [loc, setLoc] = useState(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ lat: number; lon: number; label: string }[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [lat, setLat] = useState(String(initial.lat));
  const [lon, setLon] = useState(String(initial.lon));
  const [label, setLabel] = useState(initial.label);
  const [searching, startSearch] = useTransition();
  const { status, error, run } = useStatus();

  const pick = (l: { lat: number; lon: number; label: string }) => run(() => saveWeatherLocation(l), () => { setLoc(l); setLat(String(l.lat)); setLon(String(l.lon)); setLabel(l.label); setResults(null); setQ(""); });
  const find = () => startSearch(async () => {
    const r = await searchTown(q);
    if ("error" in r) { setSearchError(r.error ?? null); setResults(null); }
    else { setSearchError(r.results.length ? null : `No town called "${q.trim()}" found.`); setResults(r.results); }
  });

  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm"><MapPin className="size-4 text-muted" /><span className="font-medium text-ink">{loc.label}</span><span className="num text-xs text-muted">{loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}</span></div>
        <SaveStatus status={status} error={error} />
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a town, like Hudson" aria-label="Search for a town" className="min-w-0 flex-1 sm:max-w-xs" enterKeyHint="search" />
        <Button type="submit" disabled={searching || q.trim().length < 2}>{searching ? "Finding…" : "Find"}</Button>
      </form>
      {searchError && <p className="text-xs text-bad">{searchError}</p>}
      {results && results.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {results.map((r) => (
            <button key={`${r.lat},${r.lon}`} type="button" onClick={() => pick(r)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-2/60">
              <span className="text-ink">{r.label}</span><span className="num text-xs text-muted">{r.lat}, {r.lon}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setManual((m) => !m)}>{manual ? "Hide" : "Type"} latitude and longitude</button>
      {manual && (
        <form className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); pick({ lat: Number(lat), lon: Number(lon), label: label.trim() }); }}>
          <label className="block"><span className="mb-1 block text-xs text-ink-2">Name</span><Input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Place name" /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-2">Latitude</span><Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" className="num" aria-label="Latitude" /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-2">Longitude</span><Input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" className="num" aria-label="Longitude" /></label>
          <Button type="submit">Use this place</Button>
        </form>
      )}
    </div>
  );
}
