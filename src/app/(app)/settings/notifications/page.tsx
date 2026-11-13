import { PushToggle } from "@/components/push-toggle";
import { Badge, Card, PageHeader, Section } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { SAMPLES, TEMPLATE_KEYS } from "@/server/email/templates";
import { emailFromAddress } from "@/server/integrations/email";
import { loadPrefs } from "@/server/services/notify";
import { listSubscriptions } from "@/server/services/push";
import Link from "next/link";
import { pushConfig } from "./actions";
import { EmailField, EventPrefs } from "./settings-client";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const s = await requireUser("MANAGER");
  const [config, devices, emp, prefs] = await Promise.all([
    pushConfig(),
    listSubscriptions(s.userId),
    db.employee.findUnique({ where: { userId: s.userId }, select: { email: true } }),
    loadPrefs(s.userId),
  ]);
  const from = emailFromAddress();

  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" description="Schedules, shift changes and the weekly brief by email and push. Staff turn theirs on from My shifts." back={{ href: "/settings", label: "Settings" }} />

      <div className="mb-10 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Email</span>{config.emailReady ? <Badge tone="good">Set up</Badge> : <Badge>Not set up</Badge>}</div>
          <p className="mt-1.5 text-sm text-muted">
            {config.emailReady ? <>Sending from {from}. Orders go to suppliers with the CSV attached.</> : <>Email isn&apos;t set up yet. Everything still works — orders can be copied, downloaded or opened in your mail app. Add <code className="text-xs">RESEND_API_KEY</code> and <code className="text-xs">EMAIL_FROM</code> to turn it on.</>}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Push</span>{config.pushReady ? <Badge tone="good">Set up</Badge> : <Badge>Not set up</Badge>}</div>
          <p className="mt-1.5 text-sm text-muted">
            {config.pushReady ? "Phones and computers can get alerts once someone turns them on below or on My shifts." : <>Push isn&apos;t set up yet. Add the <code className="text-xs">VAPID_*</code> keys (see .env.example) to turn it on.</>}
          </p>
        </Card>
      </div>

      <Section title="This device">
        <Card className="p-4">
          <PushToggle variant="inline" initial={config} />
          {devices.length > 0 && (
            <div className="mt-4 border-t border-border pt-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted">Your devices with notifications on</div>
              <ul className="space-y-1">
                {devices.map((d) => (
                  <li key={d.endpoint} className="flex justify-between gap-3"><span>{d.device ?? "Browser"}</span><span className="text-muted">added {relativeTime(new Date(d.addedAt))}</span></li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <p className="mt-2 text-xs text-muted">On iPhone, push only works once the app is on your Home Screen: open it in Safari, tap Share → Add to Home Screen, then open it from the icon.</p>
      </Section>

      <Section title="Your email">
        <EmailField initial={prefs.email} fallback={emp?.email ?? null} />
      </Section>

      <Section title="What you get" description="Staff only get schedule and shift messages about themselves.">
        <Card className="p-4"><EventPrefs initial={config} /></Card>
      </Section>

      {process.env.NODE_ENV !== "production" && (
        <Section title="Email previews" description="Development only — sample data.">
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_KEYS.map((k) => (
              <Link key={k} href={`/settings/notifications/preview/${k}`} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2">{SAMPLES[k].label}</Link>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
