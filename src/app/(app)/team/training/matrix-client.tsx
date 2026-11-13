"use client";

import { HelpTip } from "@/components/help";
import { Badge, Card, cx, Select } from "@/components/ui";
import type { CertStatus } from "@/domain/certs";
import type { CellView, PersonView, TypeView } from "@/server/services/training";
import { useEffect, useMemo, useState } from "react";
import { CertSheet } from "./cert-sheet";
import { CELL_CLASS, cellText, STATUS_LABEL, STATUS_TONE } from "./status";

export interface PositionOpt { id: string; name: string; color: string }

const STATUS_FILTERS = [
  { value: "", label: "Everyone" },
  { value: "attention", label: "Needs attention" },
  { value: "expired", label: "Expired" },
  { value: "expiring", label: "Expiring in 30 days" },
  { value: "missing", label: "Missing" },
  { value: "unverified", label: "Not verified yet" },
  { value: "ok", label: "All in date" },
];

function matches(cells: CellView[], f: string) {
  const req = cells.filter((c) => c.required);
  switch (f) {
    case "attention": return req.some((c) => c.status !== "valid");
    case "expired":
    case "expiring":
    case "missing": return req.some((c) => c.status === f);
    case "unverified": return cells.some((c) => c.current && !c.current.verifiedAt);
    case "ok": return req.every((c) => c.status === "valid" || c.status === "expiring");
    default: return true;
  }
}

/** People × certificate types. Tap a cell to add, renew, view or verify. */
export function CertMatrix({ people, types, cells, positions, today, focus }: { people: PersonView[]; types: TypeView[]; cells: Record<string, Record<string, CellView>>; positions: PositionOpt[]; today: string; focus?: string }) {
  const [position, setPosition] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<{ employeeId: string; typeId: string } | null>(null);
  const cols = types.filter((t) => t.active);
  const posName = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const shown = people.filter((p) => (!position || p.positionIds.includes(position)) && matches(cols.map((t) => cells[p.id][t.id]), status));

  // Arriving from the Team page (?person=…): scroll that row into view.
  useEffect(() => {
    if (!focus) return;
    const visible = [...document.querySelectorAll<HTMLElement>(`[data-person="${focus}"]`)].find((e) => e.offsetParent !== null);
    visible?.scrollIntoView({ block: "center" });
  }, [focus]);

  const openPerson = open ? people.find((p) => p.id === open.employeeId) : null;
  const openType = open ? types.find((t) => t.id === open.typeId) : null;

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" data-tour="training.filters">
        <Select aria-label="Filter by position" value={position} onChange={(e) => setPosition(e.target.value)} options={[{ value: "", label: "All positions" }, ...positions.map((p) => ({ value: p.id, label: p.name }))]} className="sm:w-44" />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_FILTERS} className="sm:w-48" />
        <span className="col-span-2 text-xs text-muted sm:ml-auto">{shown.length} of {people.length} {people.length === 1 ? "person" : "people"}</span>
      </div>

      {cols.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-muted">No certificate types yet. Add one under Certificate types below.</Card>
      ) : shown.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-muted">Nobody matches those filters.</Card>
      ) : (
        <>
          {/* Wide screens: the matrix. */}
          <Card className="hidden overflow-x-auto sm:block" data-tour="training.matrix">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-44 border-b border-border bg-surface px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted">Person</th>
                  {cols.map((t) => (
                    <th key={t.id} className="min-w-28 border-b border-border px-2 py-2.5 text-left align-bottom text-[0.75rem] font-medium text-muted">
                      <span className="line-clamp-2 leading-tight" title={t.description ?? t.name}>{t.name}</span>
                      <span className="num mt-0.5 block text-[11px] font-normal text-muted/80">{t.requiredCount ? `${t.okCount}/${t.requiredCount} in date` : "Optional"}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} data-person={p.id} className={cx("group transition-colors duration-120", focus === p.id && "bg-area/[0.06]")}>
                    <td className={cx("sticky left-0 z-10 border-b border-border bg-surface px-4 py-2 align-middle group-last:border-b-0", focus === p.id && "bg-[color-mix(in_oklab,var(--area)_6%,var(--surface))]")}>
                      <div className="font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted">
                        {p.positionIds.map((id) => posName.get(id)?.name).filter(Boolean).join(", ") || "No position"}
                        {p.isMinor && " · minor"}
                      </div>
                    </td>
                    {cols.map((t) => {
                      const c = cells[p.id][t.id];
                      return (
                        <td key={t.id} className="border-b border-border px-1.5 py-1.5 align-middle group-last:border-b-0">
                          <Cell c={c} label={`${p.name}: ${t.name}`} onClick={() => setOpen({ employeeId: p.id, typeId: t.id })} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Phones: a card per person with what they need. */}
          <div className="space-y-3 sm:hidden" data-tour="training.matrix">
            {shown.map((p) => {
              const mine = cols.map((t) => ({ t, c: cells[p.id][t.id] })).filter(({ c }) => c.required || c.current);
              return (
                <Card key={p.id} data-person={p.id} className={cx("overflow-hidden", focus === p.id && "ring-2 ring-area/40")}>
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted">{p.positionIds.map((id) => posName.get(id)?.name).filter(Boolean).join(", ") || "No position"}{p.isMinor && " · minor"}</div>
                    </div>
                    <Badge tone={STATUS_TONE[p.worst]}>{p.worst === "valid" ? "All in date" : p.worst === "not-required" ? "Nothing needed" : STATUS_LABEL[p.worst]}</Badge>
                  </div>
                  {mine.length === 0 ? <p className="px-4 py-3 text-sm text-muted">No certificates needed for their positions.</p> : (
                    <div className="divide-y divide-border">
                      {mine.map(({ t, c }) => (
                        <button key={t.id} type="button" onClick={() => setOpen({ employeeId: p.id, typeId: t.id })} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm active:bg-surface-2">
                          <span className="min-w-0">
                            <span className="block truncate">{t.name}</span>
                            {!c.required && <span className="block text-xs text-muted">Optional</span>}
                          </span>
                          <CellChip c={c} />
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <Legend />
        </>
      )}

      {open && openPerson && openType && (
        <CertSheet person={openPerson} type={openType} cell={cells[open.employeeId][open.typeId]} today={today} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function Cell({ c, label, onClick }: { c: CellView; label: string; onClick: () => void }) {
  const status: CertStatus = c.required ? c.status : c.current ? c.status : "not-required";
  const unverified = c.current && !c.current.verifiedAt;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${STATUS_LABEL[status]}${unverified ? ", not verified" : ""}`}
      className={cx(
        "relative flex h-9 w-full items-center justify-center rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors duration-120 ease-motion",
        CELL_CLASS[status],
        !c.required && c.current && "opacity-60",
      )}
    >
      <span className="num">{cellText({ status, expiresOn: c.expiresOn, daysLeft: c.daysLeft, hasCert: !!c.current })}</span>
      {unverified && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-warn ring-2 ring-surface" title="Not verified yet" />}
    </button>
  );
}

function CellChip({ c }: { c: CellView }) {
  const status: CertStatus = c.required ? c.status : c.current ? c.status : "not-required";
  return (
    <span className={cx("relative inline-flex h-8 min-w-24 shrink-0 items-center justify-center rounded-md px-2.5 text-xs font-medium", CELL_CLASS[status], !c.required && "opacity-60")}>
      <span className="num">{cellText({ status, expiresOn: c.expiresOn, daysLeft: c.daysLeft, hasCert: !!c.current })}</span>
      {c.current && !c.current.verifiedAt && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-warn ring-2 ring-surface" />}
    </span>
  );
}

function Legend() {
  const items: [CertStatus, string][] = [["valid", "In date (month it runs to)"], ["expiring", "Expires within 30 days"], ["expired", "Expired"], ["missing", "Required, nothing on file"]];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      {items.map(([s, l]) => (
        <span key={s} className="inline-flex items-center gap-1.5"><span className={cx("inline-block size-3 rounded-[4px]", CELL_CLASS[s])} />{l}</span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-warn" />Uploaded by staff, not verified yet</span>
      <span className="inline-flex items-center gap-1">Faded = optional <HelpTip id="training.matrix" /></span>
    </div>
  );
}
