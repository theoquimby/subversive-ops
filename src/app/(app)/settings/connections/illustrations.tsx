/**
 * Step-by-step pictures for Settings → Connections: stylized mock-ups of the
 * outside services' screens (generic shapes and labels — no logos, not
 * pixel copies), with numbered callouts on exactly what to click.
 *
 * Drawn with theme tokens so they follow light/dark mode. Callouts use the
 * focus blue ("look here"); the ring pulse respects reduced motion (globals.css).
 */

import type { ReactNode } from "react";

const HI = "var(--focus)";
const INK = "var(--ink)";
const INK2 = "var(--ink-2)";
const MUTED = "var(--muted)";
const LINE = "var(--border-strong)";
const SOFT = "var(--border)";
const SURF = "var(--surface)";
const SURF2 = "var(--surface-2)";
const MONO = "var(--font-geist-mono), ui-monospace, monospace";

// ---- Primitives ------------------------------------------------------------------

function T({ x, y, s = 10, w = 400, c = INK, a, mono, children }: { x: number; y: number; s?: number; w?: number; c?: string; a?: "start" | "middle" | "end"; mono?: boolean; children: ReactNode }) {
  return (
    <text x={x} y={y} fontSize={s} fontWeight={w} fill={c} textAnchor={a} fontFamily={mono ? MONO : undefined}>
      {children}
    </text>
  );
}

/** A grey bar standing in for text we don't need to read. */
const Bar = ({ x, y, w, h = 5, c = SOFT }: { x: number; y: number; w: number; h?: number; c?: string }) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={c} />;

const Box = ({ x, y, w, h, r = 6, fill = SURF, stroke = SOFT }: { x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string }) => (
  <rect x={x} y={y} width={w} height={h} rx={r} fill={fill} stroke={stroke} />
);

function Btn({ x, y, w, h = 18, label, primary, s = 9 }: { x: number; y: number; w: number; h?: number; label: string; primary?: boolean; s?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} fill={primary ? INK : SURF} stroke={primary ? INK : LINE} />
      <T x={x + w / 2} y={y + h / 2 + s * 0.36} s={s} w={600} c={primary ? SURF : INK} a="middle">
        {label}
      </T>
    </g>
  );
}

function Field({ x, y, w, h = 18, label, value, mono, masked }: { x: number; y: number; w: number; h?: number; label?: string; value?: string; mono?: boolean; masked?: boolean }) {
  return (
    <g>
      {label && (
        <T x={x} y={y - 6} s={8} w={500} c={INK2}>
          {label}
        </T>
      )}
      <rect x={x} y={y} width={w} height={h} rx={4} fill={SURF} stroke={LINE} />
      {value && (
        <T x={x + 6} y={y + h / 2 + 3} s={8} c={masked ? MUTED : INK} mono={mono}>
          {value}
        </T>
      )}
    </g>
  );
}

/** Spotlight: a soft tinted outline around the thing to click. */
const Spot = ({ x, y, w, h, r = 7 }: { x: number; y: number; w: number; h: number; r?: number }) => (
  <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={r} fill={HI} fillOpacity={0.1} stroke={HI} strokeWidth={1.75} />
);

/** Numbered callout with a gentle pulse. */
function Num({ x, y, n }: { x: number; y: number; n: number | string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={8} fill={HI} className="callout-ring" />
      <circle cx={x} cy={y} r={8} fill={HI} stroke={SURF} strokeWidth={1.5} />
      <T x={x} y={y + 3.2} s={9} w={700} c="#fff" a="middle">
        {n}
      </T>
    </g>
  );
}

/** Arrow from (x1,y1) to (x2,y2), gently curved. */
function Arrow({ x1, y1, x2, y2, bend = 0.25 }: { x1: number; y1: number; x2: number; y2: number; bend?: number }) {
  const mx = (x1 + x2) / 2 - (y2 - y1) * bend;
  const my = (y1 + y2) / 2 + (x2 - x1) * bend;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const head = (d: number) => `${x2 - 6 * Math.cos(ang + d)},${y2 - 6 * Math.sin(ang + d)}`;
  return (
    <g>
      <path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={HI} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="3 3" />
      <polygon points={`${x2},${y2} ${head(0.45)} ${head(-0.45)}`} fill={HI} />
    </g>
  );
}

/** Mouse pointer resting on a spot. */
const Cursor = ({ x, y }: { x: number; y: number }) => (
  <path d={`M${x},${y} l0,13 l3.5,-3.2 l2.6,5.6 l2.2,-1 l-2.6,-5.5 l4.8,-0.4 z`} fill={INK} stroke={SURF} strokeWidth={1} strokeLinejoin="round" />
);

const Check = ({ x, y, on = true }: { x: number; y: number; on?: boolean }) => (
  <g>
    <rect x={x} y={y} width={8} height={8} rx={2} fill={on ? INK : SURF} stroke={on ? INK : LINE} />
    {on && <path d={`M${x + 1.8},${y + 4.2} l1.8,1.8 l3,-3.6`} fill="none" stroke={SURF} strokeWidth={1.3} strokeLinecap="round" />}
  </g>
);

/** A generic grey square where a service's logo would be. */
const Mark = ({ x, y, s = 12 }: { x: number; y: number; s?: number }) => <rect x={x} y={y} width={s} height={s} rx={3} fill={LINE} />;

// ---- Frames ------------------------------------------------------------------------

export function Browser({ url, label, h = 200, children }: { url: string; label: string; h?: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 320 ${h}`} role="img" aria-label={label} className="block h-auto w-full select-none">
      <rect x={0.5} y={0.5} width={319} height={h - 1} rx={10} fill={SURF} stroke={LINE} />
      <path d={`M0.5,22 L0.5,10.5 Q0.5,0.5 10.5,0.5 L309.5,0.5 Q319.5,0.5 319.5,10.5 L319.5,22 Z`} fill={SURF2} />
      <line x1={0.5} x2={319.5} y1={22} y2={22} stroke={SOFT} />
      {[12, 22, 32].map((cx) => (
        <circle key={cx} cx={cx} cy={11} r={2.8} fill={LINE} />
      ))}
      <rect x={46} y={5} width={226} height={12} rx={6} fill={SURF} stroke={SOFT} />
      <path d="M53,9.5 a2,2 0 0 1 4,0 v1 h0.6 v4 h-5.2 v-4 h0.6 z" fill={MUTED} />
      <T x={61} y={13.8} s={7.5} c={MUTED}>
        {url}
      </T>
      <g transform="translate(0,22)">{children}</g>
    </svg>
  );
}

/** Side navigation column inside a browser mock-up. */
function SideNav({ items, active, h = 178, title }: { items: string[]; active?: number; h?: number; title?: string }) {
  return (
    <g>
      <rect x={0.5} y={0} width={76} height={h - 1} fill={SURF2} />
      <line x1={77} x2={77} y1={0} y2={h - 1} stroke={SOFT} />
      {title && (
        <T x={10} y={16} s={8} w={600} c={INK2}>
          {title}
        </T>
      )}
      {items.map((it, i) => (
        <g key={it}>
          {i === active && <rect x={5} y={(title ? 26 : 10) + i * 18} width={66} height={15} rx={4} fill={SURF} stroke={SOFT} />}
          <T x={11} y={(title ? 36.5 : 20.5) + i * 18} s={8.5} w={i === active ? 600 : 400} c={i === active ? INK : INK2}>
            {it}
          </T>
        </g>
      ))}
    </g>
  );
}

export function Phone({ label, kind, children }: { label: string; kind: "ios" | "android"; children: ReactNode }) {
  return (
    <svg viewBox="0 0 150 290" role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-[13rem] select-none">
      <rect x={1} y={1} width={148} height={288} rx={kind === "ios" ? 24 : 16} fill={INK} />
      <rect x={6} y={6} width={138} height={278} rx={kind === "ios" ? 19 : 12} fill={SURF} />
      {kind === "ios" ? <rect x={55} y={10} width={40} height={10} rx={5} fill={INK} /> : <circle cx={75} cy={14} r={3.5} fill={INK} />}
      <T x={16} y={19} s={7} w={600}>
        9:41
      </T>
      <rect x={118} y={13} width={14} height={6} rx={1.5} fill="none" stroke={INK} strokeWidth={0.8} />
      <rect x={119.5} y={14.5} width={9} height={3} rx={0.5} fill={INK} />
      <g transform="translate(6,26)">{children}</g>
    </svg>
  );
}

// ---- Square ------------------------------------------------------------------------

export const SquareSignIn = () => (
  <Browser url="developer.squareup.com/apps" label="Square's developer site: sign in at the top right, then press the plus tile to create an application.">
    <Mark x={12} y={10} />
    <T x={30} y={20} s={10} w={600}>
      Developer
    </T>
    <Bar x={110} y={15} w={34} />
    <Bar x={152} y={15} w={28} />
    <Btn x={252} y={8} w={56} label="Sign in" />
    <Spot x={252} y={8} w={56} h={18} />
    <Num x={248} y={8} n={1} />
    <T x={16} y={52} s={13} w={700}>
      Applications
    </T>
    <Bar x={16} y={60} w={120} />
    <rect x={16} y={78} width={110} height={84} rx={8} fill={SURF2} stroke={LINE} strokeDasharray="4 3" />
    <circle cx={71} cy={110} r={13} fill={SURF} stroke={LINE} />
    <path d="M71,103 v14 M64,110 h14" stroke={INK} strokeWidth={2} strokeLinecap="round" />
    <T x={71} y={142} s={8} a="middle" c={INK2}>
      Create your first
    </T>
    <T x={71} y={152} s={8} a="middle" c={INK2}>
      application
    </T>
    <Spot x={16} y={78} w={110} h={84} r={10} />
    <Num x={128} y={80} n={2} />
    <Cursor x={74} y={112} />
    <rect x={140} y={78} width={110} height={84} rx={8} fill={SURF} stroke={SOFT} />
    <Bar x={152} y={92} w={60} />
    <Bar x={152} y={102} w={80} />
    <Bar x={152} y={112} w={44} />
  </Browser>
);

export const SquareName = () => (
  <Browser url="developer.squareup.com/apps" label="The Create application box: type Subversive Ops as the name, then press Save.">
    <rect x={0} y={0} width={320} height={178} fill={INK} fillOpacity={0.06} />
    <Box x={60} y={22} w={200} h={134} r={10} stroke={LINE} />
    <T x={76} y={44} s={11} w={700}>
      Create application
    </T>
    <Field x={76} y={66} w={168} label="Application name" value="Subversive Ops" />
    <Spot x={76} y={66} w={168} h={18} />
    <Num x={252} y={66} n={1} />
    <Bar x={76} y={98} w={120} />
    <Bar x={76} y={108} w={90} />
    <Btn x={142} y={128} w={48} label="Cancel" />
    <Btn x={196} y={128} w={48} label="Save" primary />
    <Spot x={196} y={128} w={48} h={18} />
    <Num x={252} y={128} n={2} />
    <Cursor x={222} y={138} />
  </Browser>
);

export const SquareProduction = () => (
  <Browser url="developer.squareup.com/apps/sq0idp-…" label="Inside your new app: switch the toggle at the top from Sandbox to Production.">
    <SideNav items={["Credentials", "OAuth", "Webhooks", "Reporting"]} active={0} title="Subversive Ops" />
    <rect x={150} y={10} width={120} height={22} rx={11} fill={SURF2} stroke={LINE} />
    <T x={180} y={24.5} s={9} a="middle" c={INK2}>
      Sandbox
    </T>
    <rect x={212} y={13} width={55} height={16} rx={8} fill={INK} />
    <T x={239.5} y={24.2} s={9} w={600} a="middle" c={SURF}>
      Production
    </T>
    <Spot x={150} y={10} w={120} h={22} r={13} />
    <Num x={282} y={21} n={1} />
    <Cursor x={240} y={22} />
    <T x={90} y={58} s={11} w={700}>
      Credentials
    </T>
    <Bar x={90} y={66} w={140} />
    <Box x={90} y={80} w={218} h={36} />
    <Bar x={100} y={90} w={70} />
    <Bar x={100} y={102} w={150} c={LINE} />
    <Box x={90} y={124} w={218} h={36} />
    <Bar x={100} y={134} w={80} />
    <Bar x={100} y={146} w={120} c={LINE} />
  </Browser>
);

export const SquareRedirect = () => (
  <Browser url="developer.squareup.com/apps/…/oauth" label="On the OAuth page: paste the redirect address into the Redirect URL box and press Save.">
    <SideNav items={["Credentials", "OAuth", "Webhooks", "Reporting"]} active={1} title="Subversive Ops" />
    <Spot x={5} y={44} w={66} h={15} r={5} />
    <Num x={74} y={44} n={1} />
    <T x={90} y={30} s={11} w={700}>
      OAuth
    </T>
    <Bar x={90} y={38} w={120} />
    <Field x={90} y={66} w={218} label="Redirect URL" value="https://…/api/square/oauth/callback" mono />
    <Spot x={90} y={66} w={218} h={18} />
    <Num x={302} y={60} n={2} />
    <Bar x={90} y={98} w={160} />
    <Bar x={90} y={108} w={110} />
    <Btn x={256} y={126} w={52} label="Save" primary />
    <Spot x={256} y={126} w={52} h={18} />
    <Num x={252} y={124} n={3} />
    <Cursor x={284} y={136} />
  </Browser>
);

export const SquareCredentials = () => (
  <Browser url="developer.squareup.com/apps/…/credentials" label="Application ID is on Credentials. Application secret is on the OAuth page — press Show, then copy.">
    <SideNav items={["Credentials", "OAuth", "Webhooks", "Reporting"]} active={0} title="Subversive Ops" />
    <Spot x={5} y={26} w={66} h={15} r={5} />
    <Num x={74} y={26} n={1} />
    <T x={90} y={30} s={11} w={700}>
      Credentials
    </T>
    <rect x={252} y={20} width={56} height={14} rx={7} fill={INK} />
    <T x={280} y={30} s={8} w={600} a="middle" c={SURF}>
      Production
    </T>
    <Field x={90} y={58} w={218} label="Application ID" value="sq0idp-Ab3dEf…" mono />
    <rect x={288} y={61} width={14} height={12} rx={3} fill={SURF2} stroke={LINE} />
    <rect x={292} y={64} width={6} height={6} rx={1} fill="none" stroke={INK2} />
    <Spot x={90} y={58} w={218} h={18} />
    <Num x={302} y={52} n={2} />
    <Field x={90} y={100} w={218} label="Application secret" value="••••••••••••••••" masked />
    <Btn x={262} y={102} w={42} h={14} label="Show" s={8} />
    <Spot x={90} y={100} w={218} h={18} />
    <Num x={302} y={94} n={3} />
    <Cursor x={282} y={110} />
    <Bar x={90} y={134} w={150} />
    <Bar x={90} y={144} w={100} />
  </Browser>
);

export const SquareAllow = () => (
  <Browser url="squareup.com/oauth2/authorize" label="Square's own page: sign in with the restaurant's Square login, then press Allow.">
    <Box x={14} y={14} w={128} h={150} r={8} />
    <Mark x={70} y={24} s={16} />
    <T x={78} y={56} s={10} w={700} a="middle">
      Sign in
    </T>
    <Field x={26} y={70} w={104} value="max@…" />
    <Field x={26} y={94} w={104} value="••••••••" masked />
    <Btn x={26} y={120} w={104} label="Sign in" primary />
    <Num x={20} y={20} n={1} />
    <Arrow x1={146} y1={89} x2={170} y2={89} bend={0} />
    <Box x={176} y={14} w={130} h={150} r={8} />
    <T x={186} y={34} s={9} w={700}>
      Subversive Ops wants
    </T>
    <T x={186} y={45} s={9} w={700}>
      to see:
    </T>
    {["Sales and orders", "Menu items", "Team members", "Timecards"].map((p, i) => (
      <g key={p}>
        <Check x={186} y={56 + i * 14} />
        <T x={198} y={63 + i * 14} s={8} c={INK2}>
          {p}
        </T>
      </g>
    ))}
    <Btn x={186} y={120} w={52} label="Deny" />
    <Btn x={244} y={120} w={52} label="Allow" primary />
    <Spot x={244} y={120} w={52} h={18} />
    <Num x={300} y={118} n={2} />
    <Cursor x={270} y={130} />
  </Browser>
);

export const SquareWebhook = () => (
  <Browser url="developer.squareup.com/apps/…/webhooks" label="Webhooks, then Subscriptions, then Add subscription: paste the address, pick the events and press Save." h={216}>
    <SideNav items={["Credentials", "OAuth", "Webhooks", "Subscriptions", "Reporting"]} active={3} title="Subversive Ops" h={194} />
    <Spot x={5} y={80} w={66} h={15} r={5} />
    <Num x={74} y={80} n={1} />
    <T x={90} y={22} s={11} w={700}>
      Add subscription
    </T>
    <Field x={90} y={40} w={104} label="Name" value="Subversive Ops" />
    <Field x={204} y={40} w={104} label="API version" value="2025-10-16" mono />
    <Field x={90} y={74} w={218} label="Notification URL" value="https://…/api/webhooks/square" mono />
    <Spot x={90} y={74} w={218} h={18} />
    <Num x={302} y={68} n={2} />
    <T x={90} y={110} s={8} w={500} c={INK2}>
      Events
    </T>
    {["order.created", "order.updated", "payment.created", "labor.timecard…"].map((e, i) => (
      <g key={e}>
        <Check x={90 + (i % 2) * 110} y={116 + Math.floor(i / 2) * 13} />
        <T x={102 + (i % 2) * 110} y={123 + Math.floor(i / 2) * 13} s={7.5} c={INK2} mono>
          {e}
        </T>
      </g>
    ))}
    <Spot x={90} y={116} w={218} h={21} />
    <Num x={302} y={112} n={3} />
    <Btn x={256} y={160} w={52} label="Save" primary />
    <Spot x={256} y={160} w={52} h={18} />
    <Num x={252} y={158} n={4} />
  </Browser>
);

export const SquareSignatureKey = () => (
  <Browser url="developer.squareup.com/apps/…/webhooks/…" label="After saving: on the subscription's page, press Show next to Signature key and copy it.">
    <SideNav items={["Credentials", "OAuth", "Webhooks", "Subscriptions", "Reporting"]} active={3} title="Subversive Ops" />
    <T x={90} y={28} s={11} w={700}>
      Subversive Ops
    </T>
    <rect x={180} y={18} width={40} height={13} rx={6.5} fill="var(--good-bg)" />
    <T x={200} y={27.5} s={7.5} w={600} a="middle" c="var(--good)">
      Enabled
    </T>
    <Bar x={90} y={44} w={180} />
    <Bar x={90} y={54} w={120} />
    <Field x={90} y={82} w={218} label="Signature key" value="••••••••••••" masked />
    <Btn x={262} y={84} w={42} h={14} label="Show" s={8} />
    <Spot x={90} y={82} w={218} h={18} />
    <Num x={302} y={76} n={1} />
    <Cursor x={282} y={92} />
    <Bar x={90} y={120} w={150} />
    <Bar x={90} y={130} w={190} />
    <Btn x={90} y={146} w={90} label="Send test event" />
  </Browser>
);

// ---- Email (Resend) ------------------------------------------------------------------

const resendNav = (active: number) => <SideNav items={["Emails", "Domains", "API Keys", "Settings"]} active={active} />;

export const ResendSignup = () => (
  <Browser url="resend.com/signup" label="The email service's sign-up page: enter your email and a password, then press Create account.">
    <Box x={90} y={10} w={140} h={158} r={10} />
    <Mark x={152} y={18} s={14} />
    <T x={160} y={46} s={11} w={700} a="middle">
      Create an account
    </T>
    <Field x={104} y={66} w={112} label="Email" value="max@yourrestaurant…" />
    <Field x={104} y={102} w={112} label="Password" value="••••••••" masked />
    <Btn x={104} y={132} w={112} label="Create account" primary />
    <Spot x={104} y={132} w={112} h={18} />
    <Num x={226} y={130} n={1} />
    <Cursor x={170} y={142} />
    <T x={244} y={64} s={7.5} c={MUTED}>
      Free for up to
    </T>
    <T x={244} y={74} s={7.5} c={MUTED}>
      3,000 emails
    </T>
    <T x={244} y={84} s={7.5} c={MUTED}>
      a month
    </T>
  </Browser>
);

export const ResendDomain = () => (
  <Browser url="resend.com/domains" label="Domains, then Add domain: type your website's domain. Copy the records it shows into your domain provider, then wait for Verified." h={214}>
    {resendNav(1)}
    <Spot x={5} y={28} w={66} h={15} r={5} />
    <Num x={74} y={28} n={1} />
    <T x={90} y={24} s={11} w={700}>
      Domains
    </T>
    <Btn x={240} y={12} w={68} label="+ Add domain" primary />
    <Spot x={240} y={12} w={68} h={18} />
    <Num x={236} y={10} n={2} />
    <Box x={90} y={42} w={218} h={146} />
    <T x={100} y={58} s={9} w={700}>
      yourrestaurant.com
    </T>
    <rect x={252} y={49} width={48} height={13} rx={6.5} fill="var(--warn-bg)" />
    <T x={276} y={58.5} s={7.5} w={600} a="middle" c="var(--warn)">
      Pending
    </T>
    <Num x={306} y={46} n={4} />
    {["Type", "Name", "Value"].map((h, i) => (
      <T key={h} x={[100, 128, 206][i]} y={78} s={7.5} w={600} c={MUTED}>
        {h}
      </T>
    ))}
    {[
      ["TXT", "resend._domain…", "p=MIGfMA0…"],
      ["MX", "send", "feedback-smtp…"],
      ["TXT", "send", "v=spf1 include…"],
    ].map((r, i) => (
      <g key={i}>
        <line x1={100} x2={298} y1={84 + i * 22} y2={84 + i * 22} stroke={SOFT} />
        <T x={100} y={98 + i * 22} s={7.5} mono>
          {r[0]}
        </T>
        <T x={128} y={98 + i * 22} s={7.5} mono>
          {r[1]}
        </T>
        <T x={206} y={98 + i * 22} s={7.5} mono c={INK2}>
          {r[2]}
        </T>
      </g>
    ))}
    <Spot x={96} y={86} w={206} h={64} />
    <Num x={92} y={90} n={3} />
    <T x={100} y={168} s={7.5} c={MUTED}>
      Copy each record into your domain provider
    </T>
    <T x={100} y={179} s={7.5} c={MUTED}>
      (GoDaddy, Squarespace, Google Domains…)
    </T>
  </Browser>
);

export const ResendKey = () => (
  <Browser url="resend.com/api-keys" label="API Keys, then Create API key: name it, choose Sending access, press Add, then copy the key that starts with re_.">
    {resendNav(2)}
    <Spot x={5} y={46} w={66} h={15} r={5} />
    <Num x={74} y={46} n={1} />
    <T x={90} y={24} s={11} w={700}>
      API Keys
    </T>
    <Btn x={228} y={12} w={80} label="+ Create API key" primary />
    <Spot x={228} y={12} w={80} h={18} />
    <Num x={224} y={10} n={2} />
    <Box x={90} y={42} w={218} h={124} r={8} stroke={LINE} />
    <Field x={102} y={62} w={92} label="Name" value="Subversive Ops" />
    <Field x={204} y={62} w={92} label="Permission" value="Sending access" />
    <T x={102} y={100} s={8} w={500} c={INK2}>
      Your key (shown once)
    </T>
    <rect x={102} y={106} width={194} height={20} rx={4} fill={SURF2} stroke={LINE} />
    <T x={109} y={119.5} s={8} mono>
      re_9xQ2…k7
    </T>
    <Btn x={252} y={109} w={40} h={14} label="Copy" s={8} />
    <Spot x={102} y={106} w={194} h={20} />
    <Num x={300} y={102} n={3} />
    <Cursor x={272} y={118} />
    <T x={102} y={150} s={7.5} c={MUTED}>
      Copy it now — it won&apos;t be shown again.
    </T>
  </Browser>
);

// ---- Claude ----------------------------------------------------------------------

const claudeNav = (active: number) => <SideNav items={["Dashboard", "API keys", "Billing", "Usage"]} active={active} title="Settings" />;

export const ClaudeSignup = () => (
  <Browser url="console.anthropic.com" label="The Claude Console: sign up with your email (or continue with Google).">
    <Box x={90} y={14} w={140} h={150} r={10} />
    <Mark x={152} y={24} s={16} />
    <T x={160} y={58} s={11} w={700} a="middle">
      Claude Console
    </T>
    <Btn x={104} y={72} w={112} label="Continue with Google" />
    <T x={160} y={104} s={7.5} a="middle" c={MUTED}>
      or
    </T>
    <Field x={104} y={112} w={112} value="max@yourrestaurant.com" />
    <Btn x={104} y={136} w={112} label="Continue with email" primary />
    <Spot x={104} y={72} w={112} h={82} r={9} />
    <Num x={226} y={70} n={1} />
  </Browser>
);

export const ClaudeBilling = () => (
  <Browser url="console.anthropic.com/settings/billing" label="Settings, then Billing: add a card and buy a little credit. Five dollars lasts most restaurants months.">
    {claudeNav(2)}
    <Spot x={5} y={62} w={66} h={15} r={5} />
    <Num x={74} y={62} n={1} />
    <T x={90} y={28} s={11} w={700}>
      Billing
    </T>
    <Box x={90} y={42} w={218} h={52} />
    <T x={100} y={60} s={8} c={MUTED}>
      Credit balance
    </T>
    <T x={100} y={80} s={16} w={700}>
      $0.00
    </T>
    <Btn x={232} y={58} w={66} label="Buy credits" primary />
    <Spot x={232} y={58} w={66} h={18} />
    <Num x={302} y={54} n={2} />
    <Cursor x={262} y={68} />
    <Box x={90} y={104} w={218} h={58} />
    <T x={100} y={120} s={8} c={MUTED}>
      Amount
    </T>
    {["$5", "$10", "$25"].map((a, i) => (
      <g key={a}>
        <rect x={100 + i * 44} y={128} width={38} height={18} rx={5} fill={i === 0 ? INK : SURF} stroke={i === 0 ? INK : LINE} />
        <T x={119 + i * 44} y={140} s={9} w={600} a="middle" c={i === 0 ? SURF : INK}>
          {a}
        </T>
      </g>
    ))}
    <Num x={96} y={126} n={3} />
  </Browser>
);

export const ClaudeKey = () => (
  <Browser url="console.anthropic.com/settings/keys" label="Settings, then API keys, then Create key: name it Subversive Ops and copy the key that starts with sk-ant-.">
    {claudeNav(1)}
    <Spot x={5} y={44} w={66} h={15} r={5} />
    <Num x={74} y={44} n={1} />
    <T x={90} y={28} s={11} w={700}>
      API keys
    </T>
    <Btn x={244} y={16} w={64} label="Create key" primary />
    <Spot x={244} y={16} w={64} h={18} />
    <Num x={240} y={14} n={2} />
    <Box x={90} y={46} w={218} h={118} r={8} stroke={LINE} />
    <Field x={102} y={66} w={194} label="Name your key" value="Subversive Ops" />
    <T x={102} y={102} s={8} w={500} c={INK2}>
      Save your key — shown only once
    </T>
    <rect x={102} y={108} width={194} height={20} rx={4} fill={SURF2} stroke={LINE} />
    <T x={109} y={121.5} s={8} mono>
      sk-ant-api03-…Xq9
    </T>
    <Btn x={252} y={111} w={40} h={14} label="Copy" s={8} />
    <Spot x={102} y={108} w={194} h={20} />
    <Num x={300} y={104} n={3} />
    <Cursor x={272} y={120} />
  </Browser>
);

// ---- Google ------------------------------------------------------------------------

export const GoogleProject = () => (
  <Browser url="console.cloud.google.com" label="Google Cloud: open the project picker at the top, press New project, name it Subversive Ops and press Create.">
    <rect x={0} y={0} width={320} height={26} fill={SURF2} />
    <Mark x={10} y={7} />
    <T x={28} y={17} s={9} w={600}>
      Google Cloud
    </T>
    <rect x={98} y={6} width={88} height={14} rx={4} fill={SURF} stroke={LINE} />
    <T x={106} y={16} s={8}>
      Select a project ▾
    </T>
    <Spot x={98} y={6} w={88} h={14} />
    <Num x={194} y={8} n={1} />
    <Box x={98} y={34} w={196} h={128} r={8} stroke={LINE} />
    <T x={110} y={52} s={10} w={700}>
      Select a project
    </T>
    <Btn x={218} y={41} w={66} label="New project" primary />
    <Spot x={218} y={41} w={66} h={18} />
    <Num x={290} y={40} n={2} />
    <Field x={110} y={82} w={172} label="Project name" value="Subversive Ops" />
    <Btn x={232} y={132} w={50} label="Create" primary />
    <Spot x={232} y={132} w={50} h={18} />
    <Num x={228} y={130} n={3} />
    <Cursor x={258} y={142} />
  </Browser>
);

export const GoogleEnable = () => (
  <Browser url="console.cloud.google.com/apis/library" label="Search for Places API (New), open it and press Enable. Google asks for a billing account the first time.">
    <rect x={0} y={0} width={320} height={26} fill={SURF2} />
    <Mark x={10} y={7} />
    <rect x={70} y={5} width={180} height={16} rx={8} fill={SURF} stroke={LINE} />
    <circle cx={80} cy={13} r={3.2} fill="none" stroke={MUTED} strokeWidth={1.2} />
    <T x={88} y={16} s={8.5}>
      Places API (New)
    </T>
    <Spot x={70} y={5} w={180} h={16} r={10} />
    <Num x={258} y={8} n={1} />
    <Box x={20} y={40} w={280} h={120} r={8} />
    <Mark x={34} y={54} s={26} />
    <T x={70} y={64} s={11} w={700}>
      Places API (New)
    </T>
    <T x={70} y={76} s={8} c={MUTED}>
      Google Maps Platform
    </T>
    <Btn x={70} y={90} w={58} label="Enable" primary />
    <Spot x={70} y={90} w={58} h={18} />
    <Num x={136} y={92} n={2} />
    <Cursor x={98} y={100} />
    <Bar x={34} y={124} w={220} />
    <Bar x={34} y={134} w={180} />
    <T x={34} y={152} s={7.5} c={MUTED}>
      Pick “Places API (New)” — not the older “Places API”.
    </T>
  </Browser>
);

export const GoogleKey = () => (
  <Browser url="console.cloud.google.com/apis/credentials" label="Credentials, then Create credentials, then API key. Copy the key that starts with AIza.">
    <SideNav items={["Enabled APIs", "Library", "Credentials", "Quotas"]} active={2} title="APIs & Services" />
    <Spot x={5} y={62} w={66} h={15} r={5} />
    <Num x={74} y={62} n={1} />
    <T x={90} y={28} s={11} w={700}>
      Credentials
    </T>
    <Btn x={210} y={16} w={98} label="+ Create credentials" />
    <Spot x={210} y={16} w={98} h={18} />
    <Num x={206} y={14} n={2} />
    <Box x={210} y={38} w={98} h={40} r={5} stroke={LINE} />
    <rect x={214} y={42} width={90} height={14} rx={3} fill={SURF2} />
    <T x={220} y={52} s={8} w={600}>
      API key
    </T>
    <Bar x={220} y={64} w={60} />
    <Box x={90} y={90} w={218} h={70} r={8} stroke={LINE} />
    <T x={102} y={108} s={9} w={700}>
      API key created
    </T>
    <rect x={102} y={116} width={194} height={20} rx={4} fill={SURF2} stroke={LINE} />
    <T x={109} y={129.5} s={8} mono>
      AIzaSyB…9fQ
    </T>
    <rect x={276} y={120} width={14} height={12} rx={3} fill={SURF} stroke={LINE} />
    <rect x={280} y={123} width={6} height={6} rx={1} fill="none" stroke={INK2} />
    <Spot x={102} y={116} w={194} h={20} />
    <Num x={300} y={112} n={3} />
    <Cursor x={282} y={128} />
  </Browser>
);

// ---- Phone notifications ----------------------------------------------------------

/** Status-bar-free app content: a few placeholder cards. */
const AppScreen = ({ dim }: { dim?: boolean }) => (
  <g opacity={dim ? 0.45 : 1}>
    <T x={12} y={22} s={10} w={700}>
      Overview
    </T>
    {[0, 1, 2].map((i) => (
      <g key={i}>
        <rect x={12} y={32 + i * 42} width={114} height={34} rx={6} fill={SURF2} />
        <Bar x={20} y={41 + i * 42} w={44} c={LINE} />
        <Bar x={20} y={52 + i * 42} w={70} />
      </g>
    ))}
  </g>
);

export const IosShare = () => (
  <Phone kind="ios" label="iPhone, in Safari: tap the Share button at the bottom — a square with an arrow pointing up.">
    <AppScreen />
    <rect x={0} y={214} width={138} height={44} fill={SURF2} />
    <rect x={14} y={219} width={110} height={14} rx={7} fill={SURF} stroke={SOFT} />
    <T x={69} y={229} s={7} a="middle" c={MUTED}>
      subversive-ops.app
    </T>
    {[18, 44, 96, 120].map((x) => (
      <rect key={x} x={x - 4} y={240} width={8} height={8} rx={1.5} fill="none" stroke={MUTED} />
    ))}
    <g>
      <rect x={64} y={242} width={10} height={9} rx={1.5} fill="none" stroke={HI} strokeWidth={1.4} />
      <path d="M69,236 v9 M66,239 l3,-3 l3,3" fill="none" stroke={HI} strokeWidth={1.4} strokeLinecap="round" />
    </g>
    <circle cx={69} cy={244} r={11} fill={HI} fillOpacity={0.12} stroke={HI} strokeWidth={1.5} />
    <Num x={69} y={204} n={1} />
    <Arrow x1={69} y1={212} x2={69} y2={231} bend={0} />
  </Phone>
);

export const IosAdd = () => (
  <Phone kind="ios" label="Scroll down the share list and tap Add to Home Screen, then Add.">
    <AppScreen dim />
    <rect x={0} y={96} width={138} height={162} rx={12} fill={SURF} stroke={LINE} />
    <rect x={56} y={101} width={26} height={3} rx={1.5} fill={LINE} />
    {["Copy", "Add to Reading List", "Add Bookmark", "Add to Home Screen", "Find on Page"].map((t, i) => (
      <g key={t}>
        <rect x={10} y={114 + i * 26} width={118} height={22} rx={6} fill={SURF2} />
        <T x={18} y={128.5 + i * 26} s={8} w={i === 3 ? 600 : 400}>
          {t}
        </T>
        <rect x={110} y={120 + i * 26} width={10} height={10} rx={2} fill="none" stroke={MUTED} />
      </g>
    ))}
    <Spot x={10} y={192} w={118} h={22} />
    <Num x={128} y={190} n={2} />
  </Phone>
);

export const IosHome = () => (
  <Phone kind="ios" label="Close Safari and open Subversive from its new icon on your Home Screen.">
    <rect x={0} y={0} width={138} height={258} fill={SURF2} />
    {Array.from({ length: 12 }, (_, i) => (
      <rect key={i} x={14 + (i % 4) * 30} y={16 + Math.floor(i / 4) * 40} width={22} height={22} rx={6} fill={LINE} opacity={0.6} />
    ))}
    <rect x={14} y={136} width={22} height={22} rx={6} fill={INK} />
    <T x={25} y={151} s={11} w={700} a="middle" c={SURF}>
      S
    </T>
    <T x={25} y={168} s={6.5} a="middle">
      Subversive
    </T>
    <Spot x={12} y={134} w={26} h={38} r={8} />
    <Num x={46} y={136} n={3} />
    <rect x={10} y={214} width={118} height={34} rx={12} fill={SURF} opacity={0.7} />
    {[22, 52, 82, 108].map((x) => (
      <rect key={x} x={x} y={220} width={20} height={20} rx={5} fill={LINE} opacity={0.6} />
    ))}
  </Phone>
);

export const IosAllow = () => (
  <Phone kind="ios" label="In the app, tap Turn on notifications, then Allow.">
    <AppScreen dim />
    <rect x={14} y={80} width={110} height={92} rx={12} fill={SURF} stroke={LINE} />
    <T x={69} y={100} s={8} w={700} a="middle">
      “Subversive” would like
    </T>
    <T x={69} y={110} s={8} w={700} a="middle">
      to send you notifications
    </T>
    <T x={69} y={124} s={6.5} a="middle" c={MUTED}>
      Alerts, sounds and badges
    </T>
    <line x1={14} x2={124} y1={136} y2={136} stroke={SOFT} />
    <line x1={69} x2={69} y1={136} y2={172} stroke={SOFT} />
    <T x={41} y={157} s={8.5} a="middle" c={HI}>
      Don&apos;t Allow
    </T>
    <T x={96} y={157} s={8.5} w={700} a="middle" c={HI}>
      Allow
    </T>
    <Spot x={72} y={140} w={48} h={28} />
    <Num x={124} y={140} n={4} />
  </Phone>
);

export const AndroidMenu = () => (
  <Phone kind="android" label="Android, in Chrome: tap the three-dot menu at the top right.">
    <rect x={0} y={0} width={138} height={22} fill={SURF2} />
    <rect x={8} y={4} width={100} height={14} rx={7} fill={SURF} stroke={SOFT} />
    <T x={16} y={14} s={7} c={MUTED}>
      subversive-ops.app
    </T>
    {[6, 11, 16].map((y) => (
      <circle key={y} cx={124} cy={y} r={1.6} fill={HI} />
    ))}
    <circle cx={124} cy={11} r={9} fill={HI} fillOpacity={0.12} stroke={HI} strokeWidth={1.5} />
    <Num x={124} y={34} n={1} />
    <g transform="translate(0,20)">
      <AppScreen />
    </g>
  </Phone>
);

export const AndroidInstall = () => (
  <Phone kind="android" label="Tap Add to Home screen (it may say Install app), then Install or Add.">
    <g transform="translate(0,20)">
      <AppScreen dim />
    </g>
    <rect x={44} y={4} width={90} height={150} rx={6} fill={SURF} stroke={LINE} />
    {["New tab", "History", "Downloads", "Share…", "Add to Home screen", "Settings"].map((t, i) => (
      <T key={t} x={52} y={22 + i * 22} s={7.5} w={i === 4 ? 600 : 400}>
        {t}
      </T>
    ))}
    <Spot x={48} y={104} w={82} h={18} />
    <Num x={40} y={112} n={2} />
  </Phone>
);

export const AndroidAllow = () => (
  <Phone kind="android" label="Open Subversive from its new icon, tap Turn on notifications, then Allow.">
    <AppScreen dim />
    <rect x={10} y={90} width={118} height={84} rx={14} fill={SURF} stroke={LINE} />
    <T x={69} y={112} s={8} w={700} a="middle">
      Allow Subversive to send
    </T>
    <T x={69} y={122} s={8} w={700} a="middle">
      you notifications?
    </T>
    <rect x={20} y={134} width={98} height={16} rx={8} fill={SURF2} />
    <T x={69} y={145} s={8} w={700} a="middle" c={HI}>
      Allow
    </T>
    <T x={69} y={166} s={8} a="middle" c={INK2}>
      Don&apos;t allow
    </T>
    <Spot x={20} y={134} w={98} h={16} r={10} />
    <Num x={124} y={134} n={3} />
  </Phone>
);

export const DesktopAllow = () => (
  <Browser url="subversive-ops.app/settings/connections" label="On a computer: press Turn on notifications, then Allow in the box under the address bar.">
    <Box x={48} y={4} w={150} h={70} r={8} stroke={LINE} />
    <T x={58} y={22} s={8.5} w={700}>
      subversive-ops.app wants to
    </T>
    <circle cx={62} cy={36} r={4} fill="none" stroke={INK2} />
    <T x={72} y={39} s={8} c={INK2}>
      Show notifications
    </T>
    <Btn x={92} y={50} w={46} h={16} label="Block" s={8} />
    <Btn x={144} y={50} w={46} h={16} label="Allow" s={8} primary />
    <Spot x={144} y={50} w={46} h={16} />
    <Num x={198} y={52} n={2} />
    <Box x={150} y={96} w={150} h={64} />
    <T x={160} y={114} s={9} w={700}>
      This device
    </T>
    <Btn x={160} y={126} w={110} label="Turn on notifications" primary />
    <Num x={278} y={130} n={1} />
    <Bar x={20} y={96} w={110} />
    <Bar x={20} y={108} w={90} />
    <Bar x={20} y={120} w={100} />
  </Browser>
);
