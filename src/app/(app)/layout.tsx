import { TableResize } from "@/components/table-resize";
import { CommandPalette, type Command } from "@/components/command-palette";
import { ConfirmProvider } from "@/components/dialog";
import { Nav } from "@/components/nav";
import { HelpProvider } from "@/components/help";
import { AreaScope } from "@/components/area";
import { RouteProgress } from "@/components/route-progress";
import { onboardingState } from "@/server/services/onboarding";
import { WhatsNew } from "@/components/whats-new";
import { hasAppRoute, whatsNewState } from "@/server/services/whatsNew";
import { addCommands, managerExtra, STAFF_EXTRA } from "./palette-extra";
import { headers } from "next/headers";
import { getSessionState, logout, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

const HELP_COMMANDS: Command[] = [
  { id: "help-center", label: "Help center", group: "Help", href: "/help" },
  { id: "help-mode", label: "Help mode — explain this page", group: "Help", href: "?help=1", hint: "?" },
];

const STAFF_COMMANDS: Command[] = [
  { id: "my-today", label: "Today", group: "Go to", href: "/my", hint: "home next shift" },
  { id: "my", label: "My shifts / request time off", group: "Do", href: "/my/shifts", hint: "swap pick up sick availability" },
  { id: "my-sick", label: "I'm out sick", group: "Do", href: "/my/shifts#sick", hint: "call out sick leave" },
  { id: "my-docs", label: "Documents, training and certificates", group: "Do", href: "/my/me", hint: "sign handbook policy upload" },
  { id: "my-notify", label: "Notifications on this phone", group: "Do", href: "/my/me#notifications", hint: "push alerts" },
  ...HELP_COMMANDS,
  { id: "tour-counting", label: "Start tour · Counting & waste", group: "Help", href: "/help?tour=counting" },
  { id: "count", label: "Start a count", group: "Do", href: "/count" },
  { id: "scan-keg", label: "Scan a keg", group: "Do", href: "/kegs/scan", hint: "keg qr kick" },
  { id: "waste", label: "Log waste", group: "Do", href: "/waste" },
  { id: "prep", label: "Prep list", group: "Go to", href: "/prep", hint: "prep sauces make" },
  { id: "notes", label: "Shift notes", group: "Go to", href: "/notes", hint: "86 handover log" },
  { id: "do-note", label: "Write a shift note", group: "Do", href: "/notes", hint: "86 handover log" },
  { id: "taps", label: "Tap list", group: "Go to", href: "/kegs/taps", hint: "beer on tap board menu" },
];

async function managerCommands(): Promise<Command[]> {
  const [recipes, ingredients, suppliers] = await Promise.all([
    db.recipe.findMany({ where: { active: true }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } }),
    db.ingredient.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return [
    { id: "go-overview", label: "Overview", group: "Go to", href: "/" },
    { id: "go-menu", label: "Menu costs", group: "Go to", href: "/menu" },
    { id: "go-variance", label: "Margin gap (theoretical vs actual)", group: "Go to", href: "/variance" },
    { id: "go-ingredients", label: "Ingredients", group: "Go to", href: "/ingredients" },
    { id: "go-prices", label: "Prices", group: "Go to", href: "/prices" },
    { id: "go-ordering", label: "Ordering", group: "Go to", href: "/ordering" },
    { id: "go-sales", label: "Sales & forecast", group: "Go to", href: "/sales", hint: "forecast" },
    { id: "go-events", label: "Events", group: "Go to", href: "/events" },
    { id: "do-event", label: "Add an event (game, music, closure)", group: "Do", href: "/events", hint: "forecast" },
    { id: "go-settings", label: "Settings", group: "Go to", href: "/settings" },
    { id: "go-feedback", label: "Feedback inbox", group: "Go to", href: "/settings/feedback", hint: "ideas problems requests claude" },
    { id: "do-bulk-recipes", label: "Bulk add recipes (paste from a spreadsheet)", group: "Do", href: "/import?for=recipes", hint: "import recipes sheet" },
    { id: "go-kegs", label: "Kegs: taps, walk-in and demand", group: "Go to", href: "/kegs", hint: "beer tap walk-in cooler" },
    { id: "go-suppliers", label: "Suppliers (add or edit)", group: "Go to", href: "/settings#suppliers", hint: "vendor distributor store" },
    { id: "go-brief", label: "Morning brief", group: "Go to", href: "/brief", hint: "today daily" },
    { id: "go-brief-week", label: "Weekly brief", group: "Go to", href: "/brief?view=week" },
    { id: "go-prep-setup", label: "Prep list setup (pars, shelf life, stations)", group: "Go to", href: "/prep/setup", hint: "prep" },
    { id: "go-beers", label: "Beers", group: "Go to", href: "/kegs/beers", hint: "beer style abv label" },
    { id: "go-private", label: "Private events", group: "Go to", href: "/events/private", hint: "party booking quote buyout" },
    { id: "go-private-setup", label: "Private events setup (spaces, packages)", group: "Go to", href: "/events/private/setup", hint: "party" },
    { id: "go-insights", label: "Insights", group: "Go to", href: "/insights", hint: "lab analytics" },
    { id: "go-recipe-drafts", label: "Recipe drafts", group: "Go to", href: "/menu/drafts", hint: "draft recipes" },
    { id: "go-quickbooks", label: "QuickBooks", group: "Go to", href: "/settings/quickbooks", hint: "accounting export" },
    { id: "go-invoice-exports", label: "Invoice exports (bills, sales journal)", group: "Go to", href: "/invoices/exports", hint: "quickbooks xero" },
    { id: "go-ask", label: "Ask a question about the numbers", group: "Do", href: "/ask", hint: "ask" },
    { id: "go-allergens", label: "Allergen chart", group: "Go to", href: "/menu/allergens" },
    { id: "go-documents", label: "Documents & policies", group: "Go to", href: "/team/documents" },
    { id: "go-training", label: "Training & certificates", group: "Go to", href: "/team/training" },
    { id: "go-schedule", label: "Schedule", group: "Go to", href: "/schedule" },
    { id: "go-tips", label: "Tips", group: "Go to", href: "/tips" },
    { id: "do-requests", label: "Approve time off & swaps", group: "Do", href: "/schedule/requests" },
    { id: "go-invoices", label: "Invoices", group: "Go to", href: "/invoices" },
    { id: "do-invoice", label: "Add an invoice or receipt", group: "Do", href: "/invoices/new", hint: "photo supplier store" },
    { id: "do-invoices-open", label: "Invoices to approve", group: "Do", href: "/invoices?status=OPEN" },
    { id: "go-pnl", label: "P&L (live prime cost)", group: "Go to", href: "/pnl" },
    { id: "go-labor", label: "Timecards", group: "Go to", href: "/labor" },
    { id: "go-team", label: "Team & positions", group: "Go to", href: "/team" },
    { id: "go-reviews", label: "Reviews", group: "Go to", href: "/reviews" },
    { id: "go-budgets", label: "Budgets & targets", group: "Go to", href: "/budgets" },
    { id: "do-payroll", label: "Download payroll spreadsheet (this week)", group: "Do", href: "/labor/payroll", hint: "csv" },
    { id: "do-labor-sync", label: "Sync team & timecards from Square", group: "Do", href: "/team" },
    { id: "do-paste-reviews", label: "Import reviews (paste)", group: "Do", href: "/reviews", hint: "reviews" },
    { id: "do-reply-reviews", label: "Reply to reviews", group: "Do", href: "/reviews?show=open" },
    { id: "do-targets", label: "Set weekly targets", group: "Do", href: "/budgets" },
    { id: "do-import", label: "Import a price sheet", group: "Do", href: "/prices/import", hint: "upload" },
    { id: "do-bulk", label: "Import ingredients & recipes from a spreadsheet", group: "Do", href: "/import", hint: "setup" },
    { id: "do-manual", label: "Update prices by hand", group: "Do", href: "/prices/update" },
    { id: "do-unlinked", label: "Link new supplier products", group: "Do", href: "/prices?filter=unlinked" },
    { id: "do-recipe", label: "New recipe", group: "Do", href: "/menu/new" },
    { id: "do-prep", label: "New prep recipe", group: "Do", href: "/menu/new?kind=PREP" },
    { id: "do-draft-beer", label: "Cost a draft beer (keg → pours)", group: "Do", href: "/menu/draft-beer", hint: "beer" },
    { id: "do-ingredient", label: "New ingredient", group: "Do", href: "/ingredients/new" },
    ...STAFF_COMMANDS.filter((c) => !c.id.startsWith("help-")),
    { id: "go-setup", label: "Finish setting up", group: "Go to", href: "/welcome" },
    ...HELP_COMMANDS,
    { id: "tour-overview", label: "Start tour · Overview", group: "Help", href: "/help?tour=overview" },
    { id: "tour-menu", label: "Start tour · Menu costs & recipe editor", group: "Help", href: "/help?tour=menu" },
    { id: "tour-prices", label: "Start tour · Importing a price sheet", group: "Help", href: "/help?tour=prices" },
    { id: "tour-ordering", label: "Start tour · Ordering", group: "Help", href: "/help?tour=ordering" },
    { id: "tour-ingredients", label: "Start tour · Ingredients grid", group: "Help", href: "/help?tour=ingredients" },
    { id: "do-sync", label: "Sync Square / map items", group: "Do", href: "/sales" },
    ...suppliers.map((s) => ({ id: `inv-${s.id}`, label: `Add invoice · ${s.name}`, group: "Do" as const, href: `/invoices/new?supplier=${s.id}`, hint: "invoice" })),
    ...suppliers.map((s) => ({ id: `order-${s.id}`, label: `Build order · ${s.name}`, group: "Do" as const, href: `/ordering/${s.id}`, hint: "order" })),
    ...recipes.map((r) => ({ id: `r-${r.id}`, label: r.name, group: "Recipes" as const, href: `/menu/${r.id}`, hint: r.kind === "PREP" ? "prep" : r.kind === "MODIFIER" ? "add-on" : "menu" })),
    ...ingredients.map((i) => ({ id: `i-${i.id}`, label: i.name, group: "Ingredients" as const, href: `/ingredients/${i.id}` })),
    ...suppliers.map((s) => ({ id: `s-${s.id}`, label: s.name, group: "Suppliers" as const, href: `/prices?supplier=${s.id}`, hint: "prices" })),
  ];
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A manager changed this login's role (or name) since it signed in: refresh the cookie.
  const { stale } = await getSessionState();
  if (stale) redirect(`/api/session/refresh?next=${encodeURIComponent((await headers()).get("x-pathname") ?? "/")}`);
  const session = await requireUser();
  async function signOut() {
    "use server";
    await logout();
    redirect("/login");
  }
  // First run: a new manager goes through setup before anything else.
  if (session.role === "MANAGER") {
    const path = (await headers()).get("x-pathname") ?? "";
    if (!path.startsWith("/welcome")) {
      const ob = await onboardingState();
      if (ob.firstRun) redirect("/welcome");
    }
  }
  const [base, whatsNew] = await Promise.all([session.role === "MANAGER" ? managerCommands() : STAFF_COMMANDS, whatsNewState(session.userId, session.role)]);
  const commands = addCommands(base, session.role === "MANAGER" ? managerExtra(hasAppRoute) : STAFF_EXTRA);
  return (
    <ConfirmProvider>
    <AreaScope className="min-h-dvh">
      <RouteProgress />
      <Nav role={session.role} name={session.name} logout={signOut} />
      <CommandPalette commands={commands} />
      <TableResize />
      <HelpProvider userId={session.userId} />
      <WhatsNew entries={whatsNew.entries} unseen={whatsNew.unseen} />
      <main className="pb-[var(--tabbar)] lg:pl-60 lg:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-12">{children}</div>
      </main>
    </AreaScope>
    </ConfirmProvider>
  );
}
