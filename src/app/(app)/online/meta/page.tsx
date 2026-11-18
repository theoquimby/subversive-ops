import Link from "next/link";
import { HelpZone } from "@/components/help";
import { Badge, Card, Section } from "@/components/ui";
import { metaSignInNote, missingScopesMessage, SCOPE_LABEL, type MetaScope } from "@/domain/metaData";
import { metaReconnectSoonState } from "@/domain/onlineChannels";
import { relativeTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { META_REDIRECT_PATH, metaStatus } from "@/server/services/metaChannels";
import { publicOrigin } from "@/server/services/public-url";
import { secretStatus } from "@/server/services/secrets";
import { CopyChip } from "../../settings/connections/google/sign-in-client";
import { MetaFeedbackButton, MetaKeyField, MetaManage, MetaPages } from "./client";

export const metadata = { title: "Connect Instagram and Facebook" };
// "Sync now" reads a month of days in one go.
export const maxDuration = 60;

/** Added by hand under each use case's Permissions and features. */
const IG_ADD: MetaScope[] = ["instagram_basic", "instagram_manage_insights"];
const PAGE_ADD: MetaScope[] = ["pages_read_engagement", "read_insights"];

export default async function MetaConnectPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; note?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const [status, origin, secrets] = await Promise.all([metaStatus(), publicOrigin(), secretStatus(["META_APP_ID", "META_APP_SECRET"])]);
  const redirect = `${origin}${META_REDIRECT_PATH}`;
  const [idS, secretS] = secrets;
  const st = status.state;
  const signedIn = status.connected || !!status.needsReconnect;
  const missing = missingScopesMessage(status.missing);
  // Nothing has come in from Meta yet, so these steps haven't been proven on this app.
  const untried = !status.hasData.instagram && !status.hasData.facebook;
  const soon = status.connected && status.reconnectBy?.soon ? metaReconnectSoonState(status.reconnectBy) : null;
  const signInNote = status.connected ? metaSignInNote({ igToken: status.igToken, userExpiresOn: status.userExpiresOn, igLinked: !!status.igId }, shortDate) : null;
  const igNote = status.igToken === "user" && status.userExpiresOn ? `Answers only to the Facebook sign-in, so it needs Connect again by ${shortDate(status.userExpiresOn)}.` : null;

  return (
    <div>
      <div className="mb-6">
        <Link href="/online" className="text-sm text-muted hover:text-ink">← Online</Link>
        <HelpZone id="online.meta" className="mt-2">
          <h2 className="text-lg font-semibold">Connect Instagram and your Facebook Page</h2>
          <p className="mt-1 max-w-2xl text-sm text-pretty text-muted">
            One sign-in with Facebook by the owner connects both, because Instagram shares its numbers through the Facebook Page it is linked to. Read-only: the app brings in totals and your own posts every night. It never posts, replies or messages, and it never sees who follows you or who liked what.
          </p>
          <p className="mt-1 max-w-2xl text-sm text-pretty text-muted">Also shows your latest posts on the website once the website reads them from Ops.</p>
        </HelpZone>
      </div>

      {untried && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-pretty text-ink-2">
          <p className="min-w-0 flex-1">These steps were checked against Meta&apos;s instructions in November 2026. If a screen looks different, send feedback from this page and we&apos;ll fix the step.</p>
          <MetaFeedbackButton />
        </Card>
      )}

      {sp.error && <Card role="status" className="mb-6 border-bad/40 p-4 text-sm text-pretty text-bad">{sp.error}</Card>}
      {sp.connected && !sp.error && <Card role="status" className="mb-6 border-good/40 p-4 text-sm text-pretty text-good">Facebook is connected. The first numbers are on their way: the last month now, older days over the next few nights.</Card>}
      {sp.note && !sp.error && <Card role="status" className="mb-6 border-warn/40 p-4 text-sm text-pretty text-warn">{sp.note}</Card>}
      {soon && (
        <Card role="status" className="mb-6 border-warn/40 p-4 text-sm text-pretty">
          <b className="font-semibold text-warn">{soon.title}.</b> <span className="text-ink-2">{soon.body} Press Connect again in Part 2.</span>
        </Card>
      )}

      <Section title="Status">
        <Card className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <StatusItem
            label="Facebook sign-in"
            tone={status.needsReconnect ? "bad" : status.connected ? (missing || soon ? "warn" : "good") : "neutral"}
            text={status.connected ? `Connected${status.connectedBy ? ` by ${status.connectedBy}` : ""}` : status.needsReconnect ? "Needs connecting again" : status.appReady ? "Ready to connect" : "Not set up"}
            note={status.needsReconnect ?? missing ?? signInNote ?? undefined}
          />
          <StatusItem
            label="Instagram"
            tone={st.instagram.error || soon ? "warn" : status.igUsername || status.igId ? "good" : "neutral"}
            text={status.igUsername ? `@${status.igUsername}` : status.igId ? "Linked" : signedIn ? (status.pageId ? "Not linked to the Page" : "Pick the Page below") : "—"}
            note={
              st.instagram.error ??
              ([st.instagram.at ? `Synced ${relativeTime(new Date(st.instagram.at))}${st.instagram.skipped.length ? `. Instagram no longer gives: ${st.instagram.skipped.join(", ")}` : ""}.` : null, igNote].filter(Boolean).join(" ") ||
                (status.pageId && !status.igId && signedIn ? "See Before you start, below." : undefined))
            }
          />
          <StatusItem
            label="Facebook Page"
            tone={st.facebook.error ? "warn" : status.pageId ? "good" : "neutral"}
            text={status.pageName ?? (signedIn ? "Pick the Page below" : "—")}
            note={st.facebook.error ?? (st.facebook.at ? `Synced ${relativeTime(new Date(st.facebook.at))}${st.facebook.skipped.length ? `. Facebook no longer gives: ${st.facebook.skipped.join(", ")}` : ""}` : undefined)}
          />
        </Card>
        {signedIn && (
          <div className="mt-4 space-y-4">
            {status.connected && <MetaPages pageId={status.pageId} pageName={status.pageName} igUsername={status.igUsername} />}
            <MetaManage />
          </div>
        )}
      </Section>

      <div id="instagram" className="scroll-mt-24">
        <Section title="Before you start" description="Four things to check first, so the sign-in finds everything. None of them changes your posts.">
          <Card className="p-4 text-sm text-pretty text-ink-2 sm:p-5">
            <ul className="space-y-3">
              <Check title="Instagram is a Business or Creator account">
                In the Instagram app: your profile → the menu → <b>Settings and activity</b> → <b>Account type and tools</b>. If it offers <i>Switch to personal account</i>, you&apos;re set. If not, press <b>Switch to professional account</b> and choose <b>Business</b>. It&apos;s free.
              </Check>
              <Check title="It is linked to the business's Facebook Page">
                On Facebook, switch to the Page, then <b>Settings → Linked accounts → Instagram → Connect account</b> and sign in to Instagram.
              </Check>
              <Check title="You have full control of the Page on your own Facebook profile">
                Not only through a business portfolio in Meta Business Suite. To check: on Facebook, switch to the Page, open <b>Settings → Page access</b>, and look for your name with full control. If it isn&apos;t there, see &ldquo;If your Page doesn&apos;t show up&rdquo; at the bottom of this page.
              </Check>
              <Check title="Some numbers need a following">
                Facebook only gives Page numbers for Pages with 100 or more likes. Instagram only gives follow and unfollow counts for accounts with 100 or more followers.
              </Check>
            </ul>
          </Card>
        </Section>
      </div>

      <Section title="Part 1 · Make a Meta app" description="Once, about 15 minutes. A Meta app is just the key that lets this app read your numbers; nobody else ever sees or uses it.">
        <ol className="space-y-3">
          <Step n={1} title="Open Meta for Developers">
            Go to <Ext href="https://developers.facebook.com/apps/creation/">developers.facebook.com/apps/creation</Ext>, signed in to the Facebook account that has full control of the business&apos;s Page. The first time, Meta asks you to register as a developer. It is free and takes a minute.
          </Step>
          <Step n={2} title="Create the app with two use cases">
            Name it <i>Subversive Ops</i>, give your email and press <b>Next</b>. On <b>Use cases</b>, tick both:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>Manage everything on your Page</b></li>
              <li><b>Manage messaging and content on Instagram</b></li>
            </ul>
            <span className="mt-2 block">Pick both now: Meta never lets you remove a use case later, and only some can be added after. Press <b>Next</b>. For the business portfolio, pick yours or <b>I don&apos;t want to connect a business portfolio yet</b>. Press <b>Next</b> through the rest, then <b>Go to dashboard</b>.</span>
          </Step>
          <Step n={3} title="Set up the Instagram use case">
            In the dashboard, open <b>Use cases</b> and press <b>Customize</b> next to <b>Manage messaging and content on Instagram</b>. Choose <b>API setup with Facebook Login</b>.
            <span className="mt-2 block rounded-lg border border-warn/40 p-3">
              <b className="font-semibold text-warn">Don&apos;t press &ldquo;Add all required permissions&rdquo;.</b> It adds <code className="font-mono text-xs">instagram_content_publishing</code>, which lets an app post. This app only reads, so add the two below instead.
            </span>
          </Step>
          <Step n={4} title="Add four read permissions">
            Still in each use case, open <b>Permissions and features</b> and press <b>Add</b> next to each of these. All four only read.
            <div className="mt-2 space-y-3">
              <ScopeList heading="Manage messaging and content on Instagram" scopes={IG_ADD} />
              <ScopeList heading="Manage everything on your Page" scopes={PAGE_ADD} />
            </div>
            <span className="mt-2 block text-muted">
              Already built in, nothing to add: <code className="font-mono text-xs">pages_show_list</code> ({SCOPE_LABEL.pages_show_list}) and <code className="font-mono text-xs">business_management</code>, which lets Facebook list a Page that a business portfolio holds. The app only reads with it. Leave everything about publishing, comments, messages and ads off.
            </span>
          </Step>
          <Step n={5} title="Add the redirect address">
            Both use cases sign in with <b>Facebook Login for Business</b>. Open <b>Facebook Login for Business → Settings</b>. Under <b>Client OAuth settings</b>, in <b>Valid OAuth Redirect URIs</b>, paste exactly:
            <div className="mt-2"><CopyChip value={redirect} /></div>
            <span className="mt-2 block">Press <b>Save changes</b>.</span>
          </Step>
          <Step n={6} title="Paste the App ID and App secret here">
            They are in <b>App settings → Basic</b>. Press <b>Show</b> next to the App secret first.
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <MetaKeyField name="META_APP_ID" label="App ID" placeholder="A number of about 16 digits" set={idS.set} hint={idS.hint} />
              <MetaKeyField name="META_APP_SECRET" label="App secret" placeholder="32 letters and numbers" set={secretS.set} hint={secretS.hint} sensitive />
            </div>
          </Step>
        </ol>
        <Card className="mt-3 p-4 text-sm text-pretty text-ink-2 sm:p-5">
          <b className="font-semibold text-ink">Leave the app in Development mode, and skip App Review.</b> That is all Meta asks of an app only its own people use; Meta&apos;s review is for apps that other businesses sign in to. It does mean whoever presses Connect must have a role on the Meta app. You already do, as the one who made it. To let someone else connect, add them under <b>App roles → Roles</b> as an Administrator or Tester, and have them accept the invitation first.
        </Card>
      </Section>

      <Section title="Part 2 · Connect" description="One minute, signed in to Facebook as someone with full control of the Page.">
        <Card className="p-4 sm:p-5">
          <p className="text-sm text-pretty text-ink-2">
            Press <b>Connect</b>. Facebook asks which Pages and Instagram accounts to share: tick the business&apos;s Page and its Instagram account, and leave every permission on. If Facebook says the app isn&apos;t available, the person signing in isn&apos;t on the Meta app yet (see the note above).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {status.appReady ? (
              <a href={signedIn ? "/api/meta/oauth/start?again=1" : "/api/meta/oauth/start"} className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-ink hover:opacity-90">
                {signedIn ? "Connect again" : "Connect"}
              </a>
            ) : (
              <span className="text-sm text-muted">Paste the App ID and App secret first (step 6).</span>
            )}
          </div>
        </Card>
      </Section>

      <Section title="If something doesn't show up">
        <div className="space-y-3">
          <Card className="p-4 text-sm text-pretty text-ink-2 sm:p-5">
            <div className="mb-1 font-semibold text-ink">If your Page doesn&apos;t show up or Instagram says it lacks permission</div>
            Most often the Page belongs to a business portfolio in Meta Business Suite, and you reach it only through that. For Pages reached that way, Meta also wants an advertising permission, which this app leaves out on purpose. The fix is to give your own Facebook profile full control of the Page: on Facebook, switch to the Page, open <b>Settings → Page access</b>, add yourself and turn on full control. Accept the invitation if Facebook sends one, then press <b>Connect again</b> above. The Page stays in the business portfolio.
          </Card>
          <Card className="p-4 text-sm text-pretty text-ink-2 sm:p-5">
            <div className="mb-1 font-semibold text-ink">If Instagram doesn&apos;t show up</div>
            Instagram only shares numbers for a Business or Creator account that is linked to the Facebook Page. Do the first two checks in <b>Before you start</b>, then press <b>Find again</b> above.
          </Card>
        </div>
        <p className="mt-3 text-xs text-pretty text-muted">
          What isn&apos;t brought in: stories (Instagram only keeps their numbers for a day), messages, and anything that names a person. Instagram also no longer gives apps a count of profile visits or website-link taps for the whole account, so those two are counted another way on the Instagram page.
        </p>
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
      {note && <p className="mt-1 line-clamp-4 text-xs text-pretty text-muted">{note}</p>}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li>
      <Card className="flex gap-3 p-4 sm:p-5">
        <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold">{n}</span>
        <div className="min-w-0 flex-1 text-sm text-pretty text-ink-2">
          <div className="mb-1 font-semibold text-ink">{title}</div>
          {children}
        </div>
      </Card>
    </li>
  );
}

function Check({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-ink-2" />
      <div className="min-w-0">
        <div className="font-semibold text-ink">{title}</div>
        {children}
      </div>
    </li>
  );
}

function ScopeList({ heading, scopes }: { heading: string; scopes: MetaScope[] }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted">Under {heading}</div>
      <ul className="mt-1 space-y-1">
        {scopes.map((s) => (
          <li key={s} className="flex flex-wrap items-baseline gap-x-2">
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{s}</code>
            <span className="text-muted">{SCOPE_LABEL[s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">{children}</a>;
}
