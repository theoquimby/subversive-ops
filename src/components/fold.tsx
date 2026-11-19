import { ChevronDown } from "lucide-react";

/**
 * One fold of detail under a page's summary: a name, the gist in a line, and
 * the table when opened. Put several inside a `Card className="overflow-hidden"`.
 */
export function Fold({ title, gist, children }: { title: string; gist?: string; children: React.ReactNode }) {
  return (
    <details className="group/fold border-b border-border last:border-b-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{title}</span>
          {gist && <span className="block text-xs text-muted">{gist}</span>}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform duration-180 group-open/fold:rotate-180" />
      </summary>
      <div className="px-3 pt-1 pb-5 sm:px-5">{children}</div>
    </details>
  );
}
