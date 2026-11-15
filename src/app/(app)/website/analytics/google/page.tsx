import Link from "next/link";
import { HelpZone } from "@/components/help";
import { Badge, Card, Section } from "@/components/ui";
import { secretStatus } from "@/server/services/secrets";
import { requireUser } from "@/server/auth";
import { GOOGLE_REDIRECT_PATH, googleStatus } from "@/server/services/googleSearch";
import { publicOrigin } from "@/server/services/public-url";
import { relativeTime } from "@/lib/format";
import { CopyChip, GoogleChoices, GoogleKeyField, GoogleManage } from "./client";

export const metadata = { title: "Connect Google" };

export default async function GoogleConnectPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const [status, origin, secrets] = await Promise.all([googleStatus(), publicOrigin(), secretStatus(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"])]);
  const redirect = `${origin}${GOOGLE_REDIRECT_PATH}`;
  const [idS, secretS] = secrets;
  const st = status.state;

  return (
    <div>
      <div className="mb-6">
        <Link href="/website/analytics" className="text-sm text-muted hover:text-ink">← Analytics</Link>
        <HelpZone id="website.analytics.googleSetup" className="mt-2">
          <h2 className="text-lg font-semibold">Connect Google Search Console and your Google listing</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">One sign-in by the owner. Search Console shows the searches that bring people to the website; the Business Profile shows how the Google listing is seen and used on Search and Maps. Read-only for Search Console; nothing is ever posted or changed on the listing.</p>
        </HelpZone>
      </div>

      {sp.error && <Card role="status" className="mb-6 border-bad/40 p-4 text-sm text-bad">{sp.error}</Card>}
      {sp.connected && !sp.error && <Card role="status" className="mb-6 border-good/40 p-4 text-sm text-good">Google is connected. The first numbers are on their way (up to 16 months of history).</Card>}

      <Section title="Status">
        <Card className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <StatusItem label="Google sign-in" tone={status.connected ? "good" : status.needsReconnect ? "bad" : "neutral"} text={status.connected ? `Connected${status.connectedBy ? ` by ${status.connectedBy}` : ""}` : status.needsReconnect ? "Needs connecting again" : status.appReady ? "Ready to connect" : "Not set up"} note={status.needsReconnect ?? undefined} />
          <StatusItem label="Search Console" tone={st.search.error ? "warn" : status.siteUrl ? "good" : "neutral"} text={status.siteUrl ?? (status.connected && status.grant.search ? "Pick a property below" : "—")} note={st.search.error ?? (st.search.at ? `Synced ${relativeTime(new Date(st.search.at))}` : undefined)} />
          <StatusItem label="Business Profile" tone={st.profile.error ? "warn" : status.location ? "good" : "neutral"} text={status.locationTitle ?? (status.connected && !status.grant.business ? "Not allowed at sign-in" : status.connected ? "Pick the listing below" : "—")} note={st.profile.error ?? (st.profile.at ? `Synced ${relativeTime(new Date(st.profile.at))}` : undefined)} />
        </Card>
        {status.connected && (
          <div className="mt-4 space-y-4">
            <GoogleChoices siteUrl={status.siteUrl} location={status.location} locationTitle={status.locationTitle} business={status.grant.business} />
            <GoogleManage />
          </div>
        )}
      </Section>

      <Section title="Part 1 · Make a Google sign-in for the app" description="Once, about 15 minutes, for whoever set up the app. You can use the same Google Cloud project as Google reviews.">
        <ol className="space-y-3">
          <Step n={1} title="Open Google Cloud">
            Go to <Ext href="https://console.cloud.google.com/">console.cloud.google.com</Ext>, signed in with the Google account that owns the listing. Pick the project you made for Google reviews, or <b>New project</b> → name it <i>Subversive Ops</i> → <b>Create</b>.
          </Step>
          <Step n={2} title="Turn on the APIs">
            In <b>APIs &amp; Services → Library</b>, search for and <b>Enable</b> each: <b>Google Search Console API</b>; and for the listing: <b>My Business Account Management API</b>, <b>My Business Business Information API</b> and <b>Business Profile Performance API</b>. (The Business Profile ones only appear after step 6 is approved.)
          </Step>
          <Step n={3} title="Set up the consent screen">
            <b>Google Auth Platform → Branding</b>: app name <i>Subversive Ops</i>, your email as support and developer contact. <b>Audience</b>: <b>External</b>, then <b>Publish app</b> so it says <b>In production</b>. While it says <i>Testing</i>, Google ends the sign-in after 7 days and the nightly sync stops.
          </Step>
          <Step n={4} title="Create the sign-in (OAuth client)">
            <b>Clients → Create client</b> (or Credentials → Create credentials → OAuth client ID) → type <b>Web application</b>. Under <b>Authorized redirect URIs</b> add exactly:
            <div className="mt-2"><CopyChip value={redirect} /></div>
            <span className="mt-2 block">Press <b>Create</b>. Google shows a Client ID and a Client secret.</span>
          </Step>
          <Step n={5} title="Paste them here">
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <GoogleKeyField name="GOOGLE_OAUTH_CLIENT_ID" label="Client ID" placeholder="1234…apps.googleusercontent.com" set={idS.set} hint={idS.hint} />
              <GoogleKeyField name="GOOGLE_OAUTH_CLIENT_SECRET" label="Client secret" placeholder="GOCSPX-…" set={secretS.set} hint={secretS.hint} sensitive />
            </div>
          </Step>
        </ol>
      </Section>

      <Section title="Part 2 · Max connects" description="One minute, signed in to the Google account that owns the listing and the Search Console property.">
        <Card className="p-4 sm:p-5">
          <p className="text-sm text-ink-2">Press <b>Connect Google</b>, pick the account, and tick both boxes (Search Console and Business Profile) before <b>Continue</b>. If Google says it hasn&apos;t verified the app, that&apos;s expected for an app only you use: <b>Advanced → Go to Subversive Ops</b>.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {status.appReady ? (
              <>
                <a href="/api/google/oauth/start" className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-ink hover:opacity-90">{status.connected ? "Connect again" : "Connect Google"}</a>
                <a href="/api/google/oauth/start?business=0" className="inline-flex h-11 items-center rounded-lg border border-border-strong px-4 text-sm font-medium hover:bg-surface-2">Search Console only</a>
              </>
            ) : (
              <span className="text-sm text-muted">Paste the Client ID and secret first (step 5).</span>
            )}
          </div>
        </Card>
      </Section>

      <Section title="Part 3 · The Google listing needs Google's OK" description="Google only lets apps read Business Profile numbers after a request. Search Console works without it.">
        <ol className="space-y-3">
          <Step n={6} title="Ask Google for Business Profile API access">
            Google&apos;s rules: the listing must be <b>verified and active for 60+ days</b> and have a <b>website</b> on it. In Cloud, copy the <b>Project number</b> (Dashboard → Project info). Open the <Ext href="https://support.google.com/business/contact/api_default">GBP API contact form</Ext>, pick <b>Application for Basic API Access</b>, and send it from an email that is an owner or manager of the listing. Google replies by email, usually within a couple of weeks.
            <span className="mt-2 block text-muted">To check: APIs &amp; Services → Business Profile Performance API → Quotas. <b>0</b> requests a minute means not approved yet; <b>300</b> means approved. Then do step 2 for the Business Profile APIs and press <b>Find again</b> above.</span>
          </Step>
          <Step n={7} title="No Search Console property yet?">
            Open <Ext href="https://search.google.com/search-console">Search Console</Ext> → <b>Add property</b>. <b>Domain</b> (covers www and every page; you add one DNS record at the domain registrar) is best; <b>URL prefix</b> with the website&apos;s address also works. Google keeps 16 months, and numbers start from the day it&apos;s verified.
          </Step>
        </ol>
      </Section>
    </div>
  );
}

function StatusItem({ label, tone, text, note }: { label: string; tone: "good" | "warn" | "bad" | "neutral"; text: string; note?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <Badge tone={tone}>{tone === "good" ? "On" : tone === "bad" ? "Fix" : tone === "warn" ? "Check" : "Off"}</Badge>
        <span className="min-w-0 truncate text-sm">{text}</span>
      </div>
      {note && <p className="mt-1 line-clamp-3 text-xs text-muted">{note}</p>}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li>
      <Card className="flex gap-3 p-4 sm:p-5">
        <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold">{n}</span>
        <div className="min-w-0 flex-1 text-sm text-ink-2">
          <div className="mb-1 font-semibold text-ink">{title}</div>
          {children}
        </div>
      </Card>
    </li>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">{children}</a>;
}
