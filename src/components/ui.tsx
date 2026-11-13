import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export { clsx as cx };

// ---- Layout -------------------------------------------------------------------

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-8">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.65rem] font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-[0.95rem] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("mb-10", className)}>
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
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={clsx("rounded-xl border border-border bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <Card className="p-5">
      <div className="text-[0.8rem] font-medium text-muted">{label}</div>
      <div className={clsx("num mt-2 text-[1.75rem] font-semibold tracking-tight", tone && toneText[tone])}>{value}</div>
      {hint && <div className="mt-1 text-[0.8rem] text-muted">{hint}</div>}
    </Card>
  );
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
  return <span className={clsx("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", toneBadge[tone], className)}>{children}</span>;
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={clsx("inline-block size-1.5 rounded-full", { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-muted" }[tone])} />;
}

// ---- Buttons ------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";
const buttonBase = "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";
const buttonVariant: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink hover:opacity-90",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "text-bad hover:bg-bad-bg",
};
const buttonSize = { sm: "h-8 px-2.5", md: "h-9 px-3.5", lg: "h-11 px-5 text-[0.95rem]" };

export function Button({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof buttonSize }) {
  return <button className={clsx(buttonBase, buttonVariant[variant], buttonSize[size], className)} {...rest} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof buttonSize }) {
  return <Link className={clsx(buttonBase, buttonVariant[variant], buttonSize[size], className)} {...rest} />;
}

// ---- Forms --------------------------------------------------------------------

const control = "h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-ink-2 focus:outline-none";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={clsx(control, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={clsx(control, "appearance-none bg-[length:12px] bg-[right_0.7rem_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%2385837c' stroke-width='1.5'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={clsx(control, "h-auto min-h-20 py-2", className)} {...rest} />;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// ---- Tables -------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={clsx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </Card>
  );
}

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th className={clsx("border-b border-border px-4 py-2.5 text-[0.75rem] font-medium whitespace-nowrap text-muted", { left: "text-left", right: "text-right", center: "text-center" }[align], className)}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className, ...rest }: ComponentProps<"td"> & { align?: "left" | "right" | "center" }) {
  return (
    <td className={clsx("border-b border-border px-4 py-3 align-middle [tr:last-child_&]:border-b-0", { left: "text-left", right: "num text-right", center: "text-center" }[align], className)} {...rest}>
      {children}
    </td>
  );
}

export function Tr({ children, className, ...rest }: ComponentProps<"tr">) {
  return <tr className={clsx("transition-colors hover:bg-surface-2/60", className)} {...rest}>{children}</tr>;
}
