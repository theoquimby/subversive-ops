import { cx } from "@/components/ui";
import { STATUS_LABEL, type StockStatus } from "@/domain/brewStock";

/*
 * Every brewing ingredient as one bar, split by where it stands. Status
 * colours mean only short, order soon and fine; never counted is an outline
 * with no fill, because what's on that shelf isn't known.
 */

const ORDER: StockStatus[] = ["short", "soon", "fine", "uncounted"];
const FILL: Record<StockStatus, string> = {
  short: "bg-bad",
  soon: "bg-warn",
  fine: "bg-good",
  uncounted: "border border-dashed border-muted bg-[repeating-linear-gradient(135deg,transparent_0_4px,var(--border-strong)_4px_5px)]",
};

export function StatusStrip({ counts }: { counts: Record<StockStatus, number> }) {
  const total = ORDER.reduce((s, k) => s + counts[k], 0);
  if (!total) return null;
  const parts = ORDER.filter((k) => counts[k] > 0);
  const label = parts.map((k) => `${counts[k]} ${STATUS_LABEL[k].toLowerCase()}`).join(", ");
  return (
    <figure>
      <div role="img" aria-label={`Brewing ingredients: ${label}`} className="flex h-4 w-full gap-0.5 overflow-hidden rounded-md">
        {parts.map((k) => (
          <div key={k} className={cx("h-full min-w-1.5 rounded-[3px]", FILL[k])} style={{ flexGrow: counts[k], flexBasis: 0 }} />
        ))}
      </div>
      <figcaption>
        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2">
          {ORDER.map((k) => (
            <li key={k} className={cx("flex items-center gap-1.5", !counts[k] && "text-muted")}>
              <span aria-hidden className={cx("size-2.5 rounded-[3px]", FILL[k])} />
              {STATUS_LABEL[k]}
              <span className="num font-medium text-ink">{counts[k]}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
