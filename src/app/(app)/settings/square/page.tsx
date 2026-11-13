import { Badge, Card, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { qty, relativeTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { squareStatus, squareStreams, squareSyncLog } from "@/server/services/square";
import { dataCoverage, getBackfill } from "@/server/services/square-sync";
import { BackfillPanel, ClearLogButton, ConnectionActions, LocationPicker } from "./square-client";

export const metadata = { title: "Square" };
// The first-import steps run as server actions from this page.
export const maxDuration = 60;

const SOURCE_LABEL = { oauth: "Signed in with Square", token: "Personal access token", env: "Hosting settings" } as const;
const STREAMS = [
  { id: "catalog", label: "Menu (catalog)", unit: "items" },
  { id: "sales", label: "Sales", unit: "orders" },
  { id: "labor", label: "Timecards", unit: "timecards" },
  { id: "live", label: "Today refresh", unit: "" },
] as const;

export default async function SquareSettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireUser("MANAGER");
  const { connected: justConnected, error } = await searchParams;
  const [status, streams, log, coverage, backfill] = await Promise.all([squareStatus(), squareStreams(), squareSyncLog(), dataCoverage(), getBackfill()]);
  const webhooksOn = !!env.SQUARE_WEBHOOK_SIGNATURE_KEY;

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Square"
        description="Sales, the menu and timecards come from Square. Once connected it keeps itself up to date — through the day and every night."
      />

      {(justConnected || error) && (
        <Card role="status" className={`mb-8 p-4 text-sm ${error ? "border-bad/40 text-bad" : "border-good/40 text-good"}`}>
          {error ? error : `Connected to ${justConnected}. Next, import your history below.`}
        </Card>
      )}

      <Section title="Connection">
        <Card className="divide-y divide-border">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <div className="text-base font-semibold">{status.connected ? status.merchantName ?? "Square account" : "Not connected"}</div>
              <div className="mt-1 text-sm text-muted">
                {status.connected
                  ? [
                      status.source && SOURCE_LABEL[status.source],
                      status.connectedAt && `connected ${relativeTime(new Date(status.connectedAt))}`,
                      status.expiresAt && `access renews automatically (current one good until ${shortDate(status.expiresAt.slice(0, 10))})`,
                    ].filter(Boolean).join(" · ")
                  : "Connect the restaurant's Square account so sales, the menu and timecards flow in."}
              </div>
              {status.source === "env" && (
                <div className="mt-1 text-sm text-muted">Connected through the hosting settings. Connect with Square here to manage it from the app instead.</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {status.connected && status.environment === "sandbox" && <Badge tone="warn">Sandbox</Badge>}
              <Badge tone={status.connected ? "good" : "warn"}>{status.connected ? "Live" : "Setup needed"}</Badge>
            </div>
          </div>
          <div className="p-5">
            <ConnectionActions connected={status.connected} source={status.source} oauthAvailable={status.oauthAvailable} />
            {status.source === "env" && (
              <div className="mt-4 border-t border-border pt-4">
                <ConnectionActions connected={false} source={null} oauthAvailable={status.oauthAvailable} />
              </div>
            )}
          </div>
        </Card>
      </Section>

      {status.locations.length > 0 && (
        <Section
          title="Locations"
          description={
            status.source === "env"
              ? "Set by SQUARE_LOCATION_ID (comma-separate several)."
              : "Sales and timecards are read from every location picked here. Square Online orders often use their own location — include it if you sell online."
          }
        >
          <LocationPicker locations={status.locations} editable={status.source !== "env"} />
        </Section>
      )}

      <Section title="First import" description="Bring in past sales and timecards so the forecast, costing and P&L have history to work with. Recent weeks come first.">
        <div id="import" className="scroll-mt-20">
          <BackfillPanel initial={backfill} connected={status.connected} />
        </div>
      </Section>

      <Section title="Data we have">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sales history" value={coverage.salesDays ? `${coverage.salesDays} days` : "None yet"} hint={coverage.firstSale && coverage.lastSale ? `${shortDate(coverage.firstSale)} – ${shortDate(coverage.lastSale)}` : "import to get started"} />
          <Stat label="Orders" value={qty(coverage.orders, 0)} hint="completed in Square" />
          <Stat label="Timecards" value={qty(coverage.timecards, 0)} hint={`${qty(coverage.squareTimecards, 0)} from Square`} />
          <Stat label="Last sale day" value={coverage.lastSale ? shortDate(coverage.lastSale) : "—"} hint={streams.live ? `today refreshed ${relativeTime(new Date(streams.live.at))}` : "not refreshed yet"} />
        </div>
      </Section>

      <Section title="Sync" description={webhooksOn ? "Square tells us about new orders and clock-ins as they happen (webhooks are on). Pages also top up today's numbers if they're more than 15 minutes old." : "Pages top up today's numbers when they're more than 15 minutes old, and everything re-syncs nightly. Turn on webhooks for instant updates (see Help)."}>
        <Table>
          <thead>
            <tr><Th>What</Th><Th>Last run</Th><Th align="right">Count</Th><Th className="hidden sm:table-cell">Range</Th></tr>
          </thead>
          <tbody>
            {STREAMS.map((s) => {
              const run = streams[s.id];
              return (
                <Tr key={s.id}>
                  <Td className="font-medium">{s.label}</Td>
                  <Td className="text-ink-2">{run ? relativeTime(new Date(run.at)) : "never"}</Td>
                  <Td align="right" className="text-ink-2">{run && s.unit ? `${qty(run.count, 0)} ${s.unit}` : "—"}</Td>
                  <Td className="hidden text-muted sm:table-cell">{run?.detail ?? ""}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        <p className="mt-3 text-sm text-muted">
          Webhooks: {webhooksOn ? <span className="text-good">on</span> : "off"} · notification URL <span className="font-mono text-[0.8rem] break-all text-ink-2">{env.SQUARE_WEBHOOK_URL || "https://<your app>/api/webhooks/square"}</span>
        </p>
      </Section>

      <Section title="Recent problems" description="The last 20 things that went wrong talking to Square, newest first." actions={log.length ? <ClearLogButton /> : undefined}>
        {log.length === 0 ? (
          <Card className="p-5 text-sm text-muted">Nothing has gone wrong.</Card>
        ) : (
          <Card className="divide-y divide-border">
            {log.map((e, i) => (
              <div key={i} className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:gap-4">
                <span className="w-28 shrink-0 text-muted">{relativeTime(new Date(e.at))}</span>
                <span className="w-20 shrink-0 text-ink-2 capitalize">{e.stream}</span>
                <span className="min-w-0 text-ink">{e.message}</span>
              </div>
            ))}
          </Card>
        )}
      </Section>
    </>
  );
}
