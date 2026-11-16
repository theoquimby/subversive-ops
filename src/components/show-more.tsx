"use client";

/**
 * ShowMore — a short list that can grow (chips, small tables of kegs, cards).
 * Shows the first `limit` items and a "Show N more" button under them; never
 * hides just one or two (see @/domain/lists). Items may be server-rendered:
 * pass them as an array, each with its own key.
 */

import { moreLabel, shownCount } from "@/domain/lists";
import { cn } from "@/lib/cn";
import { ChevronDown } from "lucide-react";
import { Children, useState, type ReactNode } from "react";

export function ShowMore({
  children,
  limit,
  noun,
  as: Tag = "div",
  className,
  buttonClassName,
  inline,
}: {
  children: ReactNode;
  limit: number;
  /** [one, many], e.g. ["keg", "kegs"]: "Show 12 more kegs". */
  noun?: [string, string];
  /** The list's own element; the button goes after it (or inside it with `inline`). */
  as?: "div" | "ul" | "ol";
  className?: string;
  buttonClassName?: string;
  /** Put the button inside the list as its last item (chip rows). */
  inline?: boolean;
}) {
  const items = Children.toArray(children);
  const [open, setOpen] = useState(false);
  const first = shownCount(items.length, limit);
  const hidden = items.length - first;
  const shown = open ? items : items.slice(0, first);
  const button = hidden > 0 && (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-muted underline decoration-border-strong underline-offset-4 transition-colors duration-120 hover:text-ink sm:min-h-8",
        !inline && "mt-1.5",
        buttonClassName,
      )}
    >
      <ChevronDown className={cn("size-3.5 transition-transform duration-180", open && "rotate-180")} />
      {open ? "Show fewer" : moreLabel(hidden, noun)}
    </button>
  );
  if (inline) {
    return (
      <Tag className={className}>
        {shown}
        {button && (Tag === "div" ? button : <li className="list-none">{button}</li>)}
      </Tag>
    );
  }
  return (
    <>
      <Tag className={className}>{shown}</Tag>
      {button}
    </>
  );
}
