import { cx } from "@/components/ui";
import { barrels } from "@/domain/kegAccounts";
import { qty, shortDate } from "@/lib/format";
import Link from "next/link";
import type { ReactNode } from "react";

/** The account types, the same list as on Setup. */
export const ACCOUNT_KINDS = [
  { value: "bar", label: "Bar" },
  { value: "restaurant", label: "Restaurant" },
  { value: "distributor", label: "Distributor" },
  { value: "consumer", label: "Person / event" },
  { value: "other", label: "Other" },
];
export const kindLabel = (kind: string) => ACCOUNT_KINDS.find((k) => k.value === kind)?.label ?? "Other";

/** "Aug 17, 2022": these pages reach back years, so the year is always shown. */
export const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;
export const daysWord = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
export const kegsWord = (n: number) => `${n} keg${n === 1 ? "" : "s"}`;
/** Gallons as barrels to one decimal: "12.4". */
export const bbl = (gallons: number) => barrels(gallons).toFixed(1);
export const gal = (gallons: number) => qty(gallons, 1);

/** A pill that picks one of a few choices kept in the address, like the range on the fleet page. */
export function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={cx("inline-flex h-10 items-center rounded-full border px-3 text-sm whitespace-nowrap sm:h-8", active ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>
      {children}
    </Link>
  );
}
