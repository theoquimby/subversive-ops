import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { SAMPLES, TEMPLATE_KEYS, type TemplateKey } from "@/server/email/templates";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata = { title: "Email preview" };

/** Development-only: renders each email template with sample data. */
export default async function EmailPreviewPage({ params, searchParams }: { params: Promise<{ template: string }>; searchParams: Promise<{ view?: string }> }) {
  await requireUser("MANAGER");
  if (process.env.NODE_ENV === "production") notFound();
  const { template } = await params;
  const { view } = await searchParams;
  if (!(TEMPLATE_KEYS as string[]).includes(template)) notFound();
  const sample = SAMPLES[template as TemplateKey];
  const r = sample.render();
  const tab = (v: string, label: string) => (
    <Link href={`?view=${v}`} replace className={(view ?? "html") === v ? "rounded-md bg-ink px-2.5 py-1.5 text-sm font-medium text-primary-ink" : "rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-surface-2"}>{label}</Link>
  );

  return (
    <>
      <PageHeader title={sample.label} description={<>Subject: <span className="text-ink">{r.subject}</span></>} back={{ href: "/settings/notifications", label: "Notifications" }} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">{tab("html", "Email")}{tab("text", "Plain text")}</div>
        <div className="flex flex-wrap gap-1 text-sm">
          {TEMPLATE_KEYS.filter((k) => k !== template).map((k) => (
            <Link key={k} href={`/settings/notifications/preview/${k}${view ? `?view=${view}` : ""}`} className="rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink">{SAMPLES[k].label}</Link>
          ))}
        </div>
      </div>
      {view === "text" ? (
        <pre className="overflow-x-auto rounded-xl border border-border bg-surface p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">{r.text}</pre>
      ) : (
        <iframe title={`${sample.label} email`} srcDoc={r.html} sandbox="" className="h-[80dvh] w-full rounded-xl border border-border bg-white" />
      )}
    </>
  );
}
