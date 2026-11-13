/**
 * Loading skeletons for route segments (loading.tsx). Each piece matches the
 * box model of the real component it stands in for (PageHeader, Stat, Table,
 * Section, Card, Field) so content swaps in without a jump. Bones are flat
 * surface-2 shapes with one soft highlight sweep (transform only); the whole
 * page waits ~90ms before fading in so fast loads never flash a skeleton.
 */

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";
import { AreaIcon } from "./area";

export function Bone({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** A text line: the box has the real line height, the bone sits inside it. */
export function TextLine({ className, line = "h-5", bone = "h-3" }: { className?: string; line?: string; bone?: string }) {
  return (
    <div className={cn("flex items-center", line)}>
      <Bone className={cn(bone, className)} />
    </div>
  );
}

/** Wraps a loading page: delayed fade-in, announced as busy for screen readers. */
export function SkeletonPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("skeleton-page", className)} aria-busy="true">
      <span className="sr-only" role="status">Loading…</span>
      {children}
    </div>
  );
}

const DESC_W = ["w-[min(36rem,92%)]", "w-[min(26rem,70%)]", "w-[min(20rem,55%)]"];

/** Same box as <PageHeader>: optional back link, area chip + title, description lines, actions. */
export function PageHeaderSkeleton({ back, description = 1, actions = 0, title = "w-52" }: { back?: boolean; description?: number; actions?: number; title?: string }) {
  return (
    <header className="mb-8">
      {back && <TextLine className="w-20" line="mb-3 h-5" />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <AreaIcon />
            <TextLine className={cn("max-w-full rounded-lg", title)} line="h-[2.475rem]" bone="h-7" />
          </div>
          {description > 0 && (
            <div className="mt-1.5 max-w-2xl">
              {Array.from({ length: description }, (_, i) => (
                <TextLine key={i} className={DESC_W[i % DESC_W.length]} line="h-[1.425rem]" bone="h-3.5" />
              ))}
            </div>
          )}
        </div>
        {actions > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: actions }, (_, i) => <Bone key={i} className={cn("h-9 rounded-lg", i === actions - 1 ? "w-32" : "w-24")} />)}
          </div>
        )}
      </div>
    </header>
  );
}

/** Same box as <Section> title + description (mb-3). */
export function SectionHeadSkeleton({ description = true, action = false, title = "w-32" }: { description?: boolean; action?: boolean; title?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <TextLine className={title} line="h-[1.425rem]" bone="h-3.5" />
        {description && <TextLine className="w-[min(22rem,70vw)]" line="mt-0.5 h-5" />}
      </div>
      {action && <Bone className="h-8 w-20 rounded-lg" />}
    </div>
  );
}

export function SectionSkeleton({ children, className = "mb-10", description = true, action = false, title }: { children: ReactNode; className?: string; description?: boolean; action?: boolean; title?: string }) {
  return (
    <section className={className}>
      <SectionHeadSkeleton description={description} action={action} title={title} />
      {children}
    </section>
  );
}

const card = "rounded-xl border border-border bg-surface";

/** Same box as <Stat>: p-5, label 19px, value 42px (mt-2), hint 19px (mt-1). */
export function StatSkeleton() {
  return (
    <div className={cn(card, "p-5")}>
      <TextLine className="w-20" line="h-[1.2rem]" />
      <TextLine className="w-24 rounded-md" line="mt-2 h-[2.625rem]" bone="h-7" />
      <TextLine className="w-28" line="mt-1 h-[1.2rem]" bone="h-2.5" />
    </div>
  );
}

export function StatRowSkeleton({ count = 4, className = "mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4" }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => <StatSkeleton key={i} />)}
    </div>
  );
}

const CELL_W = ["w-[70%]", "w-[45%]", "w-[55%]", "w-[35%]", "w-[60%]", "w-[40%]"];

/**
 * Same box as <Table>: a Card, a 38px header row, then rows of `row` height.
 * `cols` are grid track sizes; columns after the first are hidden on phones
 * unless `phoneCols` says otherwise (tables hide secondary columns there).
 */
export function TableSkeleton({ rows = 8, cols = ["2fr", "1fr", "1fr", "1fr"], row = "h-[2.8rem]", phoneCols = 2, className }: { rows?: number; cols?: string[]; row?: string; phoneCols?: number; className?: string }) {
  const tracks = cols.join(" ");
  const phoneTracks = cols.slice(0, phoneCols).join(" ");
  const Row = ({ header, i }: { header?: boolean; i: number }) => (
    <div
      className={cn("grid items-center gap-6 border-border px-4 [grid-template-columns:var(--phone)] sm:[grid-template-columns:var(--tracks)]", header ? "h-[2.4rem] border-b" : cn(row, "border-b last:border-b-0"))}
      style={{ "--tracks": tracks, "--phone": phoneTracks } as React.CSSProperties}
    >
      {cols.map((_, c) => (
        <div key={c} className={cn("flex", c > 0 && "justify-end", c >= phoneCols && "hidden sm:flex")}>
          <Bone className={cn(header ? "h-2.5 w-14" : "h-3", !header && (c === 0 ? CELL_W[i % CELL_W.length] : "w-[60%] max-w-20"))} />
        </div>
      ))}
    </div>
  );
  return (
    <div className={cn(card, "overflow-hidden", className)}>
      <Row header i={0} />
      {Array.from({ length: rows }, (_, i) => <Row key={i} i={i} />)}
    </div>
  );
}

/** Cards with a title line and a few text lines. */
export function CardGridSkeleton({ count = 3, className = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3", height = "h-36", lines = 2 }: { count?: number; className?: string; height?: string; lines?: number }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn(card, "flex flex-col p-4", height)}>
          <TextLine className="w-1/2" bone="h-3.5" />
          {Array.from({ length: lines }, (_, l) => <TextLine key={l} className={l % 2 ? "w-2/3" : "w-4/5"} line="mt-1 h-5" bone="h-2.5" />)}
          <div className="mt-auto flex items-end justify-between">
            <TextLine className="w-16" />
            <Bone className="h-7 w-16 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A Card of labelled fields (Field: 0.8rem label + 6px gap + 36px control). */
export function FormSkeleton({ fields = 4, className = "grid gap-4 sm:grid-cols-2", submit = true, cardClass }: { fields?: number; className?: string; submit?: boolean; cardClass?: string }) {
  return (
    <div className={cn(card, "p-5", cardClass)}>
      <div className={className}>
        {Array.from({ length: fields }, (_, i) => (
          <div key={i}>
            <TextLine className={i % 2 ? "w-16" : "w-24"} line="mb-1.5 h-[1.2rem]" />
            <Bone className="h-10 w-full rounded-lg sm:h-9" />
          </div>
        ))}
      </div>
      {submit && <div className="mt-5 flex justify-end"><Bone className="h-9 w-28 rounded-lg" /></div>}
    </div>
  );
}

/** A Card of divided rows (lists, settings rows, recent items). */
export function ListSkeleton({ rows = 4, row = "h-14", className, meta = true }: { rows?: number; row?: string; className?: string; meta?: boolean }) {
  return (
    <div className={cn(card, "divide-y divide-border", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn("flex items-center justify-between gap-4 px-4", row)}>
          <div className="min-w-0 flex-1">
            <TextLine className={CELL_W[i % CELL_W.length]} line="h-5" />
            {meta && <TextLine className="w-1/3" line="h-4" bone="h-2.5" />}
          </div>
          <Bone className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

/** A row of pill / segmented-control bones (filters, period switches). */
export function ChipsSkeleton({ count = 4, className = "mb-4" }: { count?: number; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {Array.from({ length: count }, (_, i) => <Bone key={i} className={cn("h-8 rounded-lg", i === 0 ? "w-14" : i % 2 ? "w-24" : "w-20")} />)}
    </div>
  );
}

/** One plain card block of a given height (charts, editors, boards). */
export function BlockSkeleton({ className = "h-56" }: { className?: string }) {
  return <div className={cn(card, "p-4", className)}><Bone className="size-full rounded-lg opacity-60" /></div>;
}
