import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HelpZone } from "@/components/help";
import { Badge, Card, cx, PageHeader } from "@/components/ui";
import type { HubPiece, HubPieceId } from "@/domain/googleHub";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { googleHubData } from "@/server/services/googleHub";
import { GOOGLE_REDIRECT_PATH } from "@/server/services/googleSearch";
import { getBusinessProfile } from "@/server/services/onboarding";
import { publicOrigin } from "@/server/services/public-url";
import { GoogleGuide, ReviewsManage, type ReviewsSetup } from "./reviews-client";
import { CopyChip, GoogleKeyField, GoogleManage, ListingPicker, SearchConsolePicker } from "./sign-in-client";

export const metadata = { title: "Google" };

/**
 * Settings → Connections → Google: every Google connection on one page. One
 * sign-in (Search Console, the Google listing, later Google Analytics) and one
 * key (Google reviews), each piece with its state, what it feeds, and only its
 * next step; the full setup steps wait in "How to set this up".
 */
export default async function GooglePage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const [data, origin, profile] = await Promise.all([googleHubData(), publicOrigin(), getBusinessProfile()]);
  const { hub, status, secrets } = data;
  const piece = (id: HubPieceId) => hub.pieces.find((p) => p.id === id)!;
  const signIn = piece("signin");
  const reviews = piece("reviews");
  const appReady = secrets.clientId.set && secrets.clientSecret.set;
  const r: ReviewsSetup = { key: secrets.places, placeId: data.place.id, placeName: data.place.name, fromListing: data.place.fromListing, businessName: profile.name, test: data.reviewsTest };

  return (
    <>
      <PageHeader help="settings.google" back={{ href: "/settings/connections", label: "Connections" }} title="Google" description={hub.summary} />

      {sp.error && <Card role="status" className="mb-6 border-bad/40 p-4 text-sm text-bad">{sp.error}</Card>}
      {sp.connected && !sp.error && <Card role="status" className="mb-6 border-good/40 p-4 text-sm text-good">Google is connected. The first numbers are on their way (up to 16 months of history).</Card>}

      <p className="mb-8 max-w-2xl text-[0.95rem] leading-relaxed text-pretty text-ink-2">
        Google needs two things from you: <b className="text-ink">one Google sign-in</b>, which covers Search Console, your Google listing and Google Analytics, and <b className="text-ink">one key</b>, which brings in Google reviews. Nothing is ever posted or changed on Google.
      </p>

      <div className="space-y-6">
        <HelpZone id="website.analytics.googleSetup" className="block">
          <Card className="p-4 sm:p-5">
            <Piece p={signIn} level={2} covers setup={<SignInSteps redirect={`${origin}${GOOGLE_REDIRECT_PATH}`} clientId={secrets.clientId} clientSecret={secrets.clientSecret} appReady={appReady} />}>
              {signIn.status === "working" ? (
                <div className="space-y-3">
                  <GoogleManage />
                  <p className="text-sm text-muted">
                    Changing Google accounts, or a box wasn&apos;t ticked? <a href="/api/google/oauth/start" className="text-ink underline underline-offset-2">Connect again</a>.
                  </p>
                </div>
              ) : appReady ? (
                <div className="flex flex-wrap gap-2">
                  <ConnectButton label={signIn.status === "fix" ? "Connect again" : "Connect Google"} />
                  {signIn.status === "fix" && <GoogleManage />}
                </div>
              ) : null}
            </Piece>

            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-4 text-xs font-medium text-muted">Under this sign-in</p>
              <div className="space-y-6 border-l-2 border-border pl-4 sm:pl-5">
                <Piece p={piece("search")} level={3} setup={<SearchSteps />}>
                  {status.connected && status.grant.search ? <SearchConsolePicker siteUrl={status.siteUrl} /> : null}
                </Piece>
                <Piece p={piece("listing")} level={3} setup={<ListingSteps />}>
                  {status.connected && status.grant.business ? <ListingPicker location={status.location} locationTitle={status.locationTitle} reviewsFollow={data.place.fromListing} /> : null}
                </Piece>
                <Piece p={piece("analytics")} level={3} setupTitle="How to get ready" setup={<AnalyticsSteps />} />
              </div>
            </div>
          </Card>
        </HelpZone>

        <HelpZone id="settings.connections.google" className="block">
          <Card className="p-4 sm:p-5">
            <Piece p={reviews} level={2} setup={<GoogleGuide r={r} />} flush>
              {data.place.id ? <ReviewsManage r={r} /> : null}
            </Piece>
          </Card>
        </HelpZone>
      </div>
    </>
  );
}

/** One piece: name and state, what it feeds, where it stands, its one next step, its controls, and the setup steps folded away. */
function Piece({ p, level, covers, setup, setupTitle = "How to set this up", flush, children }: { p: HubPiece; level: 2 | 3; covers?: boolean; setup?: React.ReactNode; setupTitle?: string; flush?: boolean; children?: React.ReactNode }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section id={p.id} aria-labelledby={`${p.id}-title`} className="scroll-mt-20">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <H id={`${p.id}-title`} className={cx("font-semibold text-ink", level === 2 ? "text-base" : "text-[0.95rem]")}>{p.title}</H>
        <Badge tone={p.tone}>{p.label}</Badge>
      </div>
      {covers && <p className="mt-1 text-sm text-muted">Covers Search Console, your Google listing and Google Analytics.</p>}
      {p.feeds && (
        <p className="mt-1 text-sm text-muted">
          {p.status === "coming" ? "Will feed " : "Feeds "}
          <Link href={p.feeds.href} className="text-ink-2 underline underline-offset-2 hover:text-ink">{p.feeds.label}</Link>
        </p>
      )}
      <p className={cx("mt-3 text-sm text-pretty", p.status === "fix" ? "text-bad" : "text-ink-2")}>
        {p.line}
        {p.syncedAt && <span className="text-muted"> Last synced {relativeTime(new Date(p.syncedAt))}.</span>}
      </p>
      {p.next && <p className="mt-1 text-sm font-medium text-pretty text-ink">{p.next}</p>}
      {children && <div className="mt-4">{children}</div>}
      {setup && (
        <details open={p.setupOpen} className="group mt-4 rounded-lg border border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 text-sm font-medium text-ink-2 select-none hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 transition-transform duration-180 group-open:rotate-90" aria-hidden />
            {setupTitle}
          </summary>
          <div className={cx("border-t border-border", !flush && "px-3.5 py-4")}>{setup}</div>
        </details>
      )}
    </section>
  );
}

function ConnectButton({ label }: { label: string }) {
  return (
    <a href="/api/google/oauth/start" className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-ink transition-opacity hover:opacity-90">
      {label}
    </a>
  );
}

function Steps({ intro, outro, children }: { intro?: React.ReactNode; outro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-ink-2">
      {intro && <p>{intro}</p>}
      <ol className="space-y-4">{children}</ol>
      {outro && <p className="text-muted">{outro}</p>}
    </div>
  );
}

function Step({ n, title, children }: { n?: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2" aria-hidden>{n ?? "•"}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 font-semibold text-ink">{title}</div>
        {children}
      </div>
    </li>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">{children}</a>;
}

function SignInSteps({ redirect, clientId, clientSecret, appReady }: { redirect: string; clientId: { set: boolean; hint: string | null }; clientSecret: { set: boolean; hint: string | null }; appReady: boolean }) {
  return (
    <Steps intro="Once, about 15 minutes, for whoever set up the app. Then the owner signs in.">
      <Step n={1} title="Open Google Cloud">
        Go to <Ext href="https://console.cloud.google.com/">console.cloud.google.com</Ext>, signed in with the Google account that owns the listing. Pick the project you made for Google reviews, or <b>New project</b> → name it <i>Subversive Ops</i> → <b>Create</b>.
      </Step>
      <Step n={2} title="Turn on the APIs">
        In <b>APIs &amp; Services → Library</b>, search for and <b>Enable</b> each: <b>Google Search Console API</b>; and for the listing: <b>My Business Account Management API</b>, <b>My Business Business Information API</b> and <b>Business Profile Performance API</b>. (The Business Profile ones only appear once Google approves access; see Google listing below.)
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
          <GoogleKeyField name="GOOGLE_OAUTH_CLIENT_ID" label="Client ID" placeholder="1234…apps.googleusercontent.com" set={clientId.set} hint={clientId.hint} />
          <GoogleKeyField name="GOOGLE_OAUTH_CLIENT_SECRET" label="Client secret" placeholder="GOCSPX-…" set={clientSecret.set} hint={clientSecret.hint} sensitive />
        </div>
      </Step>
      <Step n={6} title="The owner connects">
        Signed in to the Google account that owns the listing and the Search Console property, press <b>Connect Google</b>, pick the account, and tick both boxes (Search Console and Business Profile) before <b>Continue</b>. If Google says it hasn&apos;t verified the app, that&apos;s expected for an app only you use: <b>Advanced → Go to Subversive Ops</b>.
        {appReady && (
          <span className="mt-2 block">
            Only want Search Console for now? <a href="/api/google/oauth/start?business=0" className="text-ink underline underline-offset-2">Connect for Search Console only</a>.
          </span>
        )}
      </Step>
    </Steps>
  );
}

function SearchSteps() {
  return (
    <Steps>
      <Step title="No Search Console property yet?">
        Open <Ext href="https://search.google.com/search-console">Search Console</Ext> → <b>Add property</b>. <b>Domain</b> (covers www and every page; you add one DNS record at the domain registrar) is best; <b>URL prefix</b> with the website&apos;s address also works. Google keeps 16 months, and numbers start from the day it&apos;s verified.
      </Step>
      <Step title="Then">
        Press <b>Find again</b> above and pick the website&apos;s property. Search Console needs no approval from Google.
      </Step>
    </Steps>
  );
}

function ListingSteps() {
  return (
    <Steps>
      <Step n={1} title="Ask Google for Business Profile API access">
        Google only lets apps read a listing&apos;s numbers after a request, and it can take a couple of weeks, so it&apos;s worth asking early. Google&apos;s rules: the listing must be <b>verified and active for 60+ days</b> and have a <b>website</b> on it. In Google Cloud, copy the <b>Project number</b> (Dashboard → Project info). Open the <Ext href="https://support.google.com/business/contact/api_default">GBP API contact form</Ext>, pick <b>Application for Basic API Access</b>, and send it from an email that is an owner or manager of the listing. Google replies by email.
      </Step>
      <Step n={2} title="Check whether it's approved">
        In Google Cloud: APIs &amp; Services → Business Profile Performance API → Quotas. <b>0</b> requests a minute means not approved yet; <b>300</b> means approved.
      </Step>
      <Step n={3} title="Once approved">
        Turn on the three Business Profile APIs (step 2 under Your Google sign-in), then press <b>Find again</b> above and pick the listing.
      </Step>
    </Steps>
  );
}

function AnalyticsSteps() {
  return (
    <Steps
      intro="Bringing in Google Analytics is being built next. Two things make it a one-minute job when it lands:"
      outro={<>Once it&apos;s built, pressing <b>Connect again</b> once asks Google for the extra permission. Read-only, like the rest.</>}
    >
      <Step n={1} title="Add the sign-in's account as a Viewer">
        Whoever runs your Google Analytics property opens <b>Admin → Property access management → Add users</b> and adds the Google account used for the sign-in above, with the <b>Viewer</b> role.
      </Step>
      <Step n={2} title="Note the property ID">
        It&apos;s under <b>Admin → Property details</b>: a number, like 412345678.
      </Step>
    </Steps>
  );
}
