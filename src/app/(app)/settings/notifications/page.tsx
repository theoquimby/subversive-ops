import { HelpZone } from "@/components/help";
import { PushToggle } from "@/components/push-toggle";
import { Badge, Card, LinkButton, PageHeader, Section } from "@/components/ui";
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
  const from = await emailFromAddress();

  return (
    <div className="max-w-3xl">
      <PageHeader help="settings.notifications" title="Notifications" description="Schedules, shift changes and the weekly brief by email and on your phone. Staff turn theirs on from My shifts." back={{ href: "/settings", label: "Settings" }} actions={<LinkButton href="/settings/connections">Connections</LinkButton>} />

      <div className="mb-10 grid gap-3 sm:grid-cols-2">
        <HelpZone id="settings.notify.email"><Card className="h-full p-4">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Email</span>{config.emailReady ? <Badge tone="good">Set up</Badge> : <Badge>Not set up</Badge>}</div>
          <p className="mt-1.5 text-sm text-muted">
            {config.emailReady ? <>Sending from {from}. Orders go to suppliers with a spreadsheet file attached.</> : <>Email isn&apos;t set up yet. Everything still works — orders can be copied, downloaded or opened in your mail app. <Link href="/settings/connections?open=email" className="text-ink underline underline-offset-2">Set up email</Link> (about 10 minutes).</>}
          </p>
        </Card></HelpZone>
        <HelpZone id="settings.notify.push"><Card className="h-full p-4">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Phone notifications</span>{config.pushReady ? <Badge tone="good">Set up</Badge> : <Badge>Not set up</Badge>}</div>
          <p className="mt-1.5 text-sm text-muted">
            {config.pushReady ? "Phones and computers can get alerts once someone turns them on below or on My shifts." : <>Phone notifications aren&apos;t turned on yet. <Link href="/settings/connections?open=push" className="text-ink underline underline-offset-2">Turn them on</Link> — one tap, no account needed.</>}
          </p>
        </Card></HelpZone>
      </div>

      <Section help="settings.notify.device" title="This device">
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
        <p className="mt-2 text-xs text-muted">On iPhone, notifications only work once the app is on your Home Screen: open it in Safari, tap Share → Add to Home Screen, then open it from the icon.</p>
      </Section>

      <Section help="settings.notify.address" title="Your email">
        <EmailField initial={prefs.email} fallback={emp?.email ?? null} />
      </Section>

      <Section help="settings.notify.events" title="What you get" description="Staff only get schedule and shift messages about themselves.">
        <Card className="p-4"><EventPrefs initial={config} /></Card>
      </Section>

      {process.env.NODE_ENV !== "production" && (
        <Section help="settings.notify.previews" title="Email previews" description="Only shown while the app is being worked on — sample data.">
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
