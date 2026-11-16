import Link from "next/link";
import { HelpZone } from "@/components/help";
import { Badge, Card, Section } from "@/components/ui";
import { META_SCOPES, missingScopesMessage, SCOPE_LABEL } from "@/domain/metaData";
import { relativeTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { META_REDIRECT_PATH, metaStatus } from "@/server/services/metaChannels";
import { publicOrigin } from "@/server/services/public-url";
import { secretStatus } from "@/server/services/secrets";
import { CopyChip } from "../../website/analytics/google/client";
import { MetaKeyField, MetaManage, MetaPages } from "./client";

export const metadata = { title: "Connect Instagram and Facebook" };
// "Sync now" reads a month of days in one go.
export const maxDuration = 60;

export default async function MetaConnectPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; note?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const [status, origin, secrets] = await Promise.all([metaStatus(), publicOrigin(), secretStatus(["META_APP_ID", "META_APP_SECRET"])]);
  const redirect = `${origin}${META_REDIRECT_PATH}`;
  const [idS, secretS] = secrets;
  const st = status.state;
  const signedIn = status.connected || !!status.needsReconnect;
  const missing = missingScopesMessage(status.missing);

  return (
    <div>
      <div className="mb-6">
        <Link href="/online" className="text-sm text-muted hover:text-ink">← Online</Link>
        <HelpZone id="online.meta" className="mt-2">
          <h2 className="text-lg font-semibold">Connect Instagram and your Facebook Page</h2>
          <p className="mt-1 max-w-2xl text-sm text-pretty text-muted">
            One sign-in with Facebook by the owner connects both, because Instagram shares its numbers through the Facebook Page it is linked to. Read-only: the app brings in totals and your own posts every night. It never posts, replies or messages, and it never sees who follows you or who liked what.
          </p>
        </HelpZone>
      </div>

      {sp.error && <Card role="status" className="mb-6 border-bad/40 p-4 text-sm text-pretty text-bad">{sp.error}</Card>}
      {sp.connected && !sp.error && <Card role="status" className="mb-6 border-good/40 p-4 text-sm text-pretty text-good">Facebook is connected. The first numbers are on their way: the last month now, older days over the next few nights.</Card>}
      {sp.note && !sp.error && <Card role="status" className="mb-6 border-warn/40 p-4 text-sm text-pretty text-warn">{sp.note}</Card>}

      <Section title="Status">
        <Card className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <StatusItem
            label="Facebook sign-in"
            tone={status.needsReconnect ? "bad" : status.connected ? (missing ? "warn" : "good") : "neutral"}
            text={status.connected ? `Connected${status.connectedBy ? ` by ${status.connectedBy}` : ""}` : status.needsReconnect ? "Needs connecting again" : status.appReady ? "Ready to connect" : "Not set up"}
            note={status.needsReconnect ?? missing ?? (status.connected && status.userExpiresOn ? `Good for finding Pages until ${shortDate(status.userExpiresOn)}. The nightly sync carries on after that.` : undefined)}
          />
          <StatusItem
            label="Instagram"
            tone={st.instagram.error ? "warn" : status.igUsername || status.igId ? "good" : "neutral"}
            text={status.igUsername ? `@${status.igUsername}` : status.igId ? "Linked" : signedIn ? (status.pageId ? "Not linked to the Page" : "Pick the Page below") : "—"}
            note={st.instagram.error ?? (st.instagram.at ? `Synced ${relativeTime(new Date(st.instagram.at))}${st.instagram.skipped.length ? `. Instagram no longer gives: ${st.instagram.skipped.join(", ")}` : ""}` : status.pageId && !status.igId && signedIn ? "See Part 3 below." : undefined)}
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

      <Section title="Part 1 · Make a Meta app" description="Once, about 15 minutes, for whoever set up the app. A Meta app is just the key that lets this app read your numbers; nobody else ever sees or uses it.">
        <ol className="space-y-3">
          <Step n={1} title="Open Meta for Developers">
            Go to <Ext href="https://developers.facebook.com/apps/creation/">developers.facebook.com/apps/creation</Ext>, signed in to the Facebook account that has full control of the business&apos;s Page. The first time, Meta asks you to register as a developer. It is free and takes a minute.
          </Step>
          <Step n={2} title="Create the app">
            Name it <i>Subversive Ops</i> and give your email. When Meta asks what the app is for, pick <b>Manage everything on your Page</b>. If that isn&apos;t offered, pick <b>Other</b>, then <b>Business</b>. For the business portfolio, pick yours or <b>I don&apos;t want to connect a business portfolio yet</b>. Finish with <b>Go to dashboard</b>.
          </Step>
          <Step n={3} title="Tick five permissions">
            In the app&apos;s dashboard, open the use case&apos;s <b>Permissions</b> (under <b>Customize</b>) and add each of these. All five only read.
            <ul className="mt-2 space-y-1">
              {META_SCOPES.map((s) => (
                <li key={s} className="flex flex-wrap items-baseline gap-x-2">
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{s}</code>
                  <span className="text-muted">{SCOPE_LABEL[s]}</span>
                </li>
              ))}
            </ul>
            <span className="mt-2 block text-muted">Leave everything about publishing, comments, messages and ads off.</span>
          </Step>
          <Step n={4} title="Add the redirect address">
            Open <b>Facebook Login → Settings</b>. Under <b>Valid OAuth Redirect URIs</b> paste exactly:
            <div className="mt-2"><CopyChip value={redirect} /></div>
            <span className="mt-2 block">Press <b>Save changes</b>.</span>
          </Step>
          <Step n={5} title="Paste the App ID and App secret here">
            They are in <b>App settings → Basic</b>. Press <b>Show</b> next to the App secret first.
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <MetaKeyField name="META_APP_ID" label="App ID" placeholder="A number of about 16 digits" set={idS.set} hint={idS.hint} />
              <MetaKeyField name="META_APP_SECRET" label="App secret" placeholder="32 letters and numbers" set={secretS.set} hint={secretS.hint} sensitive />
            </div>
          </Step>
        </ol>
        <Card className="mt-3 p-4 text-sm text-pretty text-ink-2 sm:p-5">
          <b className="font-semibold text-ink">Leave the app in Development mode.</b> That is all Meta asks of an app only its own people use; Meta&apos;s review is for apps that other businesses sign in to. It does mean whoever presses Connect must have a role on the Meta app. You already do, as the one who made it. To let someone else connect, add them under <b>App roles → Roles</b> as an Administrator or Tester, and have them accept the invitation first.
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
              <span className="text-sm text-muted">Paste the App ID and App secret first (step 5).</span>
            )}
          </div>
        </Card>
      </Section>

      <div id="instagram" className="scroll-mt-24">
        <Section title="Part 3 · If Instagram doesn't show up" description="Instagram only shares numbers for a professional account that is linked to the Facebook Page. Both are free and change nothing about your posts.">
          <ol className="space-y-3">
            <Step n={6} title="Make the Instagram account a professional one">
              In the Instagram app, open your profile → the menu → <b>Settings</b> → <b>Account type and tools</b> → <b>Switch to professional account</b>, and choose <b>Business</b>. If it already says <i>Switch to personal account</i>, it is professional already.
            </Step>
            <Step n={7} title="Link it to the Facebook Page">
              On Facebook, switch to the Page, then <b>Settings → Linked accounts → Instagram → Connect account</b> and sign in to Instagram. Come back here and press <b>Find again</b> above.
            </Step>
          </ol>
          <p className="mt-3 text-xs text-pretty text-muted">
            What isn&apos;t brought in: stories (Instagram only keeps their numbers for a day), messages, and anything that names a person. Instagram also no longer gives apps a count of profile visits or website-link taps for the whole account, so those two are counted another way on the Instagram page.
          </p>
        </Section>
      </div>
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

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">{children}</a>;
}
