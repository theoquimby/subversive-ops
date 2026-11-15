import { cx } from "@/components/ui";
import Link from "next/link";

/** Today | Setup — managers only (staff just see the list). */
export function PrepTabs({ active }: { active: "today" | "setup" }) {
  const item = (id: "today" | "setup", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === id ? "page" : undefined}
      className={cx("-mb-px inline-flex h-11 items-center border-b-2 px-1 text-sm font-medium transition-colors duration-120 sm:h-10", active === id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Prep" className="mb-6 flex gap-5 border-b border-border" data-tour="prep.tabs">
      {item("today", "/prep", "Prep list")}
      {item("setup", "/prep/setup", "Prep setup")}
    </nav>
  );
}
