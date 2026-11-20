import { Badge, Card, cx } from "@/components/ui";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/*
 * The pieces of a page that tells its numbers as a story: a finding with its
 * picture and what to do about it (Chapter), the table behind it for anyone
 * who wants it (Numbers), and the list of findings at the top (InShort).
 */

export type FindingTone = "good" | "warn" | "bad" | "neutral";

export interface Finding {
  tone: FindingTone;
  title: string;
  detail: string;
  action: string | null;
}

const FLAG = { good: "Going well", warn: "Worth a look", bad: "Needs attention" } as const;
const DOT = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-border-strong" } as const;

/** A table tucked under its chart. */
export function Numbers({ children, label = "The numbers" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group/num mt-4 border-t border-border pt-2">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-md pr-2 text-sm text-muted transition-colors duration-120 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden className="size-4 transition-transform duration-180 group-open/num:rotate-180" />
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/**
 * One finding: what it is, the picture, what to do about it, and the table
 * underneath. With a `point` the heading, detail and action come from it;
 * `title` and `detail` are what shows when nothing stood out.
 */
export function Chapter({ id, point, title, detail, children, numbers, className }: { id: string; point?: Finding; title: string; detail?: ReactNode; children: ReactNode; numbers?: ReactNode; className?: string }) {
  const tone = point?.tone ?? "neutral";
  return (
    <Card id={id} className={cx("flex scroll-mt-24 flex-col p-4 sm:p-6", className)}>
      {tone !== "neutral" && (
        <div className="mb-2">
          <Badge tone={tone}>{FLAG[tone]}</Badge>
        </div>
      )}
      <h3 className="max-w-3xl text-base font-semibold tracking-tight text-balance text-ink sm:text-lg">{point?.title ?? title}</h3>
      {(point?.detail ?? detail) && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{point?.detail ?? detail}</p>}
      <div className="mt-5 flex-1">{children}</div>
      {point?.action && (
        <div className="mt-5 flex gap-2.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm text-ink">
          <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          <p className="max-w-2xl font-medium">{point.action}</p>
        </div>
      )}
      {numbers && <Numbers>{numbers}</Numbers>}
    </Card>
  );
}

/** The findings as a list, each jumping to its chapter. */
export function InShort({ items }: { items: { id: string; point: Finding }[] }) {
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {items.map(({ id, point }) => (
        <a key={id} href={`#${id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors duration-120 hover:bg-surface-2/60 sm:px-5">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[point.tone]}`} />
          <span className="min-w-0 flex-1 text-sm font-medium text-ink">
            {point.title}
            {point.tone !== "neutral" && <span className="sr-only"> ({FLAG[point.tone]})</span>}
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
        </a>
      ))}
    </Card>
  );
}
