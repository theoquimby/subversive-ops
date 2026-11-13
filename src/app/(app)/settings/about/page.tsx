import { Badge, PageHeader } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { lastSquareSync } from "@/server/services/sales";
import { weatherStatus } from "@/server/services/forecasting";
import { analyticsStatus } from "@/server/services/analytics";
import { LinkRow, SettingGroup } from "../controls";
import { settingsSummary } from "../summary";

export const metadata = { title: "Help & about" };

export default async function AboutSettingsPage() {
  await requireUser("MANAGER");
  const [sync, weather, insights, { connected, connectionsTotal }] = await Promise.all([lastSquareSync(), weatherStatus(), analyticsStatus(), settingsSummary()]);
  const when = (iso: string | null | undefined) => (iso ? relativeTime(new Date(iso)) : "never");
  const status = [
    { label: "Square sales", value: sync ? relativeTime(sync) : "never", ok: !!sync && Date.now() - sync.getTime() < 36 * 3600_000 },
    { label: "Weather for the forecast", value: weather.error ? "couldn't update" : when(weather.lastOk), ok: !weather.error && !!weather.lastOk },
    { label: "Insights worked out", value: insights.error ? "couldn't update" : when(insights.lastOk), ok: !insights.error && !!insights.lastOk },
  ];
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Help & about" description="Where to get help, and whether everything is running." />

      <SettingGroup title="Help" description="Tap the ? next to anything for a short explanation, or turn on help mode from the menu and tap any part of a page.">
        <LinkRow href="/help" label="Help center" what="Every page and setting explained in plain English, with search." help="settings.about" />
        <LinkRow href="/help?tour=overview" label="Take the tour" what="A two-minute walk around the Overview." />
        <LinkRow href="/welcome" label="Setup checklist" what="The first-run steps: basics, suppliers, your data, Square, logins, the first count." />
      </SettingGroup>

      <SettingGroup title="Is everything running?">
        {status.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <span className="text-sm text-ink">{s.label}</span>
            <span className="flex items-center gap-2 text-sm text-ink-2">{s.value}<Badge tone={s.ok ? "good" : "warn"}>{s.ok ? "OK" : "Check"}</Badge></span>
          </div>
        ))}
        <LinkRow href="/settings/connections" label="Connections" what="Square, email, phone alerts, AI, Google reviews and QuickBooks." value={`${connected} of ${connectionsTotal} on`} />
      </SettingGroup>

      <p className="px-1 text-xs text-muted">Subversive Ops · version 0.1</p>
    </div>
  );
}
