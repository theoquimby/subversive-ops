"use client";

import { cx } from "@/components/ui";
import { linkSummaryText, type LinkSummary } from "@/domain/brewIngredientLink";
import Link from "next/link";
import { useState } from "react";

/** What linking recipe lines to ingredients did: the counts, lines left with why, and where to price them next. */
export function LinkSummaryView({ s, pricesHref = "/brewery/recipes#prices", className }: { s: LinkSummary; pricesHref?: string; className?: string }) {
  const [all, setAll] = useState(false);
  const left = s.linesLeft;
  const shown = all ? left : left.slice(0, 5);
  return (
    <div className={cx("space-y-1.5 text-sm", className)}>
      <p>{linkSummaryText(s)}</p>
      {s.productsCreated > 0 && (
        <p className="text-muted">
          {s.productsCreated === 1 ? "1 ingredient is" : `${s.productsCreated} ingredients are`} now bought from the supplier its recipe line names, so ordering knows who to order from.
        </p>
      )}
      {left.length > 0 && (
        <div>
          <p className="text-muted">Left for you to match on the recipe:</p>
          <ul className={cx("mt-1 list-disc space-y-0.5 pl-5 text-muted", all && "max-h-72 overflow-y-auto")}>
            {shown.map((l, i) => (
              <li key={i}>
                <span className="text-ink-2">{l.line}</span> in {l.recipe}: {l.why}
              </li>
            ))}
          </ul>
          {left.length > 5 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 min-h-10 text-xs text-muted underline underline-offset-2 hover:text-ink sm:min-h-0">
              {all ? "Show fewer" : `Show all ${left.length}`}
            </button>
          )}
        </div>
      )}
      {s.linesLinked > 0 && (
        <p>
          Next: fill in their prices in{" "}
          <Link href={pricesHref} className="font-medium text-ink underline underline-offset-2 hover:no-underline">
            Brewing ingredient prices
          </Link>
          , so costs come through.
        </p>
      )}
    </div>
  );
}
