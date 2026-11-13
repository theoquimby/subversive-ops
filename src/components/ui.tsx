import clsx from "clsx";
import { cn } from "@/lib/cn";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export { clsx as cx };
import { HelpZone } from "./help";
import { AreaIcon } from "./area";

/** Wrap in a help-mode zone when a help id is given (see src/help/README.md). */
const withHelp = (help: string | undefined, node: ReactNode, className?: string) => (help ? <HelpZone id={help} className={className}>{node}</HelpZone> : node);

// ---- Layout -------------------------------------------------------------------

export function PageHeader({ title, description, actions, back, help }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; help?: string }) {
  return withHelp(help, (
    <header className="mb-8">
      {back && (
        <Link href={back.href} className="relative mb-3 inline-flex items-center gap-1 text-sm text-muted transition-colors duration-120 after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-[''] hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <AreaIcon />
            <h1 className="min-w-0 text-[1.65rem] font-semibold tracking-tight text-ink">{title}</h1>
          </div>
          {description && <p className="mt-1.5 max-w-2xl text-[0.95rem] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  ), "mb-8 [&>header]:mb-0");
}

/**
 * `fill`: stretch to the height of the row it sits in (side-by-side panels),
 * with the section's main content growing to match its neighbour.
 */
export function Section({ title, description, actions, children, className, help, fill }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; help?: string; fill?: boolean }) {
  return withHelp(help, (
    <section className={cn("mb-10", fill && "flex h-full flex-col [&>*:last-child]:flex-1", !help && className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            {title && <h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  ), cn("mb-10 [&>section]:mb-0", fill && "h-full", className));
}

/** A surface. Inside a link it lifts slightly on hover and gives on press (see globals.css [data-card]). */
export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div data-card="" className={cn("rounded-xl border border-border bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

/** A number tile. `accent` (on by default) draws a faint top edge in the page's area hue. Values render as-is, no count-up. */
export function Stat({ label, value, hint, tone, help, accent = true }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone; help?: string; accent?: boolean }) {
  return withHelp(help, (
    <Card className={cn("flex h-full min-w-0 flex-col p-5", accent && "relative overflow-hidden before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-area/55 before:via-area/15 before:via-45% before:to-transparent before:content-['']")}>
      {/* One-line label so every value in a row lines up; the card stretches to the row's height. */}
      <div className="truncate text-[0.8rem] font-medium text-muted">{label}</div>
      <div className={cn("num mt-2 truncate text-[1.75rem] font-semibold tracking-tight transition-colors duration-180", tone && toneText[tone])}>{value}</div>
      {hint && <div className="mt-1 line-clamp-2 text-[0.8rem] text-muted">{hint}</div>}
    </Card>
  ), "h-full min-w-0");
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div className="text-[0.95rem] font-medium text-ink">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

// ---- Status -------------------------------------------------------------------

export type Tone = "good" | "warn" | "bad" | "neutral";
const toneText: Record<Tone, string> = { good: "text-good", warn: "text-warn", bad: "text-bad", neutral: "text-ink" };
const toneBadge: Record<Tone, string> = {
  good: "bg-good-bg text-good",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  neutral: "bg-surface-2 text-ink-2",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-180 ease-motion", toneBadge[tone], className)}>{children}</span>;
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={cn("inline-block size-1.5 rounded-full transition-colors duration-180", { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-muted" }[tone])} />;
}

// ---- Buttons ------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";
// Press: a 2% give on :active (transform only), colors ease in 120ms.
const buttonBase = "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-[color,background-color,border-color,opacity,transform,box-shadow,outline-color,outline-offset] duration-120 ease-motion active:scale-[0.98] active:duration-75 disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap select-none";
const buttonVariant: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink hover:opacity-90",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "text-bad hover:bg-bad-bg",
};
const buttonSize = { sm: "h-8 px-2.5", md: "h-9 px-3.5", lg: "h-11 px-5 text-[0.95rem]" };

export function Button({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof buttonSize }) {
  return <button className={cn(buttonBase, buttonVariant[variant], buttonSize[size], className)} {...rest} />;
}

export { DatePicker } from "./date-picker";
export { Combobox } from "./combobox";

export function LinkButton({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof buttonSize }) {
  return <Link className={cn(buttonBase, buttonVariant[variant], buttonSize[size], className)} {...rest} />;
}

// ---- Forms --------------------------------------------------------------------

const control = "h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base sm:h-9 sm:text-sm text-ink placeholder:text-muted/70 transition-[border-color,box-shadow] duration-120 ease-motion hover:border-ink-2/40 focus:border-ink-2 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_7%,transparent)] focus:outline-none";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...rest} />;
}

export { Select } from "./select";

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "h-auto min-h-20 py-2", className)} {...rest} />;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// ---- Tables -------------------------------------------------------------------

/**
 * `sticky`: the table scrolls inside its frame (at most a screen tall) so the header row
 * stays in view and the first column stays put when scrolling sideways. For lists that
 * can run long; for big, searchable lists use DataTable (@/components/data-table).
 */
export function Table({ children, className, sticky }: { children: ReactNode; className?: string; sticky?: boolean }) {
  return (
    <Card className={cn(sticky ? "max-h-[calc(100dvh-8rem)] overflow-auto overscroll-x-contain" : "overflow-x-auto", className)}>
      <table className={cn("w-full text-sm", sticky ? "table-sticky border-separate border-spacing-0" : "border-collapse")}>{children}</table>
    </Card>
  );
}

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th className={cn("border-b border-border px-4 py-2.5 text-[0.75rem] font-medium whitespace-nowrap text-muted", { left: "text-left", right: "text-right", center: "text-center" }[align], className)}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className, ...rest }: ComponentProps<"td"> & { align?: "left" | "right" | "center" }) {
  return (
    <td className={cn("border-b border-border px-4 py-3 align-middle [tr:last-child_&]:border-b-0", { left: "text-left", right: "num text-right", center: "text-center" }[align], className)} {...rest}>
      {children}
    </td>
  );
}

export function Tr({ children, className, ...rest }: ComponentProps<"tr">) {
  return <tr className={cn("transition-colors duration-120 hover:bg-surface-2/60", className)} {...rest}>{children}</tr>;
}
