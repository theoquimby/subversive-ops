import type { Command } from "@/components/command-palette";

/**
 * Command bar entries for the pages and tours that landed recently (What's
 * new), kept apart from layout.tsx so they can be added without touching the
 * main lists. `addCommands` drops anything whose id — or the same link in the
 * same group — is already there, so other additions never double up.
 */

const whatsNew: Command = { id: "help-whats-new", label: "What's new", group: "Help", href: "?whatsnew=1", hint: "changes updates new features" };

export const STAFF_EXTRA: Command[] = [
  whatsNew,
  { id: "tour-today", label: "Start tour · Your day in the app", group: "Help", href: "/help?tour=today", hint: "staff today" },
  { id: "tour-prep", label: "Start tour · Prep list", group: "Help", href: "/help?tour=prep" },
  { id: "tour-notes", label: "Start tour · Shift notes", group: "Help", href: "/help?tour=notes" },
  { id: "tour-kegs", label: "Start tour · Kegs", group: "Help", href: "/help?tour=kegs", hint: "scan kick" },
];

/** `hasRoute` gates pages still landing (website, accounting). */
export function managerExtra(hasRoute: (route: string) => boolean): Command[] {
  return [
    whatsNew,
    { id: "help-quick-start", label: "Quick start: your first week", group: "Help", href: "/help/app.quickStart", hint: "getting started begin max" },
    { id: "go-setup-checklist", label: "Setup checklist", group: "Go to", href: "/welcome/checklist", hint: "finish setting up onboarding connect" },
    { id: "go-ordering-orders", label: "Orders (drafts, sent, received)", group: "Go to", href: "/ordering?tab=orders", hint: "purchase orders po" },
    { id: "go-deadlines", label: "Delivery days & order deadlines", group: "Go to", href: "/settings/suppliers", hint: "supplier cutoff order by" },
    { id: "go-storage-areas", label: "Storage areas (walking order)", group: "Go to", href: "/settings/areas", hint: "count walk-in shelves" },
    { id: "go-square-settings", label: "Square: connection & history import", group: "Go to", href: "/settings/square", hint: "sync backfill" },
    { id: "go-square-menu", label: "Menu from Square (link items to recipes)", group: "Go to", href: "/sales/square-menu", hint: "map items mapping" },
    { id: "go-connections", label: "Connections (Square, email, AI, QuickBooks…)", group: "Go to", href: "/settings/connections", hint: "integrations keys claude" },
    { id: "do-ai-key", label: "Turn on AI features (Claude key)", group: "Do", href: "/settings/connections?open=ai", hint: "anthropic claude api key" },
    { id: "go-logins", label: "Logins & roles", group: "Go to", href: "/settings/people", hint: "invite staff manager pin" },
    { id: "go-business-hours", label: "Business profile & opening hours", group: "Go to", href: "/settings/business", hint: "hours suggestions learned" },
    { id: "go-notifications", label: "Notifications (email & phone)", group: "Go to", href: "/settings/notifications", hint: "push alerts" },
    { id: "go-kegs-cooler", label: "Kegs · walk-in", group: "Go to", href: "/kegs/cooler", hint: "cooler find beer" },
    { id: "go-kegs-demand", label: "Kegs · demand per beer", group: "Go to", href: "/kegs/demand", hint: "brew plan" },
    { id: "go-kegs-all", label: "Kegs · every keg", group: "Go to", href: "/kegs/all", hint: "list labels qr" },
    { id: "go-kegs-setup", label: "Kegs · setup (spots, pours, accounts)", group: "Go to", href: "/kegs/setup" },
    { id: "tour-pnl", label: "Start tour · P&L", group: "Help", href: "/help?tour=pnl" },
    { id: "tour-insights", label: "Start tour · Insights Lab", group: "Help", href: "/help?tour=insights" },
    { id: "tour-brief", label: "Start tour · Morning brief", group: "Help", href: "/help?tour=brief" },
    { id: "tour-private-events", label: "Start tour · Private events", group: "Help", href: "/help?tour=private-events" },
    { id: "tour-training", label: "Start tour · Training & certificates", group: "Help", href: "/help?tour=training" },
    ...STAFF_EXTRA.filter((c) => c.id !== whatsNew.id && c.id !== "tour-today"),
    ...(hasRoute("/website")
      ? ([
          { id: "go-website", label: "Website", group: "Go to", href: "/website", hint: "site public" },
          { id: "go-website-hours", label: "Website · hours & notice", group: "Go to", href: "/website/hours", hint: "closed holiday" },
          { id: "go-website-menu", label: "Website · menu", group: "Go to", href: "/website/menu" },
          { id: "go-website-events", label: "Website · events", group: "Go to", href: "/website/events" },
          { id: "go-website-inquiries", label: "Website · inquiries", group: "Go to", href: "/website/inquiries", hint: "private party contact form" },
          { id: "go-website-content", label: "Website · pages & links", group: "Go to", href: "/website/content" },
          { id: "tour-website", label: "Start tour · Website", group: "Help", href: "/help?tour=website" },
        ] satisfies Command[])
      : []),
    ...(hasRoute("/website/analytics")
      ? ([
          { id: "go-website-analytics", label: "Website · analytics", group: "Go to", href: "/website/analytics", hint: "visitors traffic google" },
          { id: "tour-webanalytics", label: "Start tour · Website analytics", group: "Help", href: "/help?tour=webanalytics" },
        ] satisfies Command[])
      : []),
    { id: "go-google", label: "Google: sign-in, Search Console, listing and reviews", group: "Go to", href: "/settings/connections/google", hint: "connect search console business profile maps places reviews key analytics" },
    ...(hasRoute("/online")
      ? ([
          { id: "go-online", label: "Online: how guests find you", group: "Go to", href: "/online", hint: "google search maps website reviews found overview" },
          { id: "go-google-listing", label: "Google listing (Maps & Search)", group: "Go to", href: "/online/google", hint: "business profile gbp calls directions views" },
        ] satisfies Command[])
      : []),
    ...(hasRoute("/accounting") ? [{ id: "go-accounting", label: "Accounting & month-end", group: "Go to", href: "/accounting", hint: "close books accountant" } satisfies Command] : []),
  ];
}

/** Append `extra` to `base`, skipping any id already used and any link already offered in the same group. */
export function addCommands(base: Command[], extra: Command[]): Command[] {
  const ids = new Set(base.map((c) => c.id));
  const links = new Set(base.map((c) => `${c.group} ${c.href}`));
  const out = [...base];
  for (const c of extra) {
    const link = `${c.group} ${c.href}`;
    if (ids.has(c.id) || links.has(link)) continue;
    ids.add(c.id);
    links.add(link);
    out.push(c);
  }
  return out;
}
