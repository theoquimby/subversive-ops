"use client";

import { Card, cx, Input, Table, Td, Th, Tr } from "@/components/ui";
import { fuzzyFilter } from "@/domain/search";
import { money, shortDate } from "@/lib/format";
import type { BatchView } from "@/server/services/brewery";
import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { abvText, BeerDot, bblText, StatusBadge } from "../bits";

const SHOW = [
  { id: "planned", label: "Planned", test: (b: BatchView) => b.status === "PLANNED" },
  { id: "tanks", label: "In tanks", test: (b: BatchView) => b.status === "FERMENTING" || b.status === "CONDITIONING" },
  { id: "packaged", label: "Packaged", test: (b: BatchView) => b.status === "PACKAGED" },
  { id: "all", label: "All", test: () => true },
] as const;
type Show = (typeof SHOW)[number]["id"];

/** Every brew with a filter and a search; each row opens the brew. */
export function BatchTable({ rows, initialShow, initialQuery }: { rows: BatchView[]; initialShow: Show; initialQuery: string }) {
  const [show, setShow] = useState<Show>(initialShow);
  const [q, setQ] = useState(initialQuery);
  const list = useMemo(() => {
    const f = rows.filter(SHOW.find((s) => s.id === show)!.test);
    return q.trim() ? fuzzyFilter(f, q, (b) => `${b.code} ${b.name} ${b.recipeName ?? ""}`, 500) : f;
  }, [rows, show, q]);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="tablist" aria-label="Show">
          {SHOW.map((s) => {
            const n = rows.filter(s.test).length;
            return (
              <button key={s.id} role="tab" aria-selected={show === s.id} onClick={() => setShow(s.id)} className={cx("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-120 sm:h-8", show === s.id ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2")}>
                {s.label}<span className={cx("num text-xs", show === s.id ? "text-surface/70" : "text-muted")}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, beer, recipe" aria-label="Search brews" className="pl-9" />
        </div>
      </div>
      {list.length ? (
        <Table sticky>
          <thead>
            <tr>
              <Th>Brew</Th>
              <Th className="hidden lg:table-cell">Recipe</Th>
              <Th className="hidden sm:table-cell">Status</Th>
              <Th>Brewed</Th>
              <Th className="hidden md:table-cell">Packaged</Th>
              <Th align="right" className="hidden sm:table-cell">Volume</Th>
              <Th align="right" className="hidden md:table-cell">ABV</Th>
              <Th align="right" className="hidden lg:table-cell">Cost</Th>
              <Th align="right" className="hidden sm:table-cell">Per pint</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <Tr key={b.id}>
                <Td className="min-w-[10rem]">
                  <Link href={`/brewery/batches/${b.id}`} className="flex min-h-10 items-center gap-2.5">
                    <BeerDot color={b.color} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{b.name}</span>
                      <span className="num block text-xs text-muted">{b.code}<span className="sm:hidden"> · {b.status === "PLANNED" ? "planned" : b.status.toLowerCase()}</span></span>
                    </span>
                  </Link>
                </Td>
                <Td className="hidden text-ink-2 lg:table-cell">{b.recipeName ?? "—"}</Td>
                <Td className="hidden sm:table-cell"><StatusBadge status={b.status} /></Td>
                <Td className="num whitespace-nowrap">{b.brewedOn ? shortDate(b.brewedOn) : b.plannedOn ? <span className="text-muted">{shortDate(b.plannedOn)}</span> : "—"}</Td>
                <Td className="num hidden whitespace-nowrap md:table-cell">{b.packagedOn ? shortDate(b.packagedOn) : "—"}</Td>
                <Td align="right" className="hidden sm:table-cell">{bblText(b.bbl)}</Td>
                <Td align="right" className="hidden md:table-cell">{abvText(b.abv)}</Td>
                <Td align="right" className="hidden lg:table-cell">{b.cost != null ? money(b.cost, { whole: true }) : <span className="text-muted">—</span>}</Td>
                <Td align="right" className="hidden sm:table-cell">{b.costPerPint != null ? money(b.costPerPint) : <span className="text-muted">—</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Card className="px-4 py-6 text-center text-sm text-muted">No brews match.</Card>
      )}
    </>
  );
}
