import { CommandPalette, type Command } from "@/components/command-palette";
import { ConfirmProvider } from "@/components/dialog";
import { Nav } from "@/components/nav";
import { HelpProvider } from "@/components/help";
import { onboardingState } from "@/server/services/onboarding";
import { headers } from "next/headers";
import { logout, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

const HELP_COMMANDS: Command[] = [
  { id: "help-center", label: "Help center", group: "Help", href: "/help" },
  { id: "help-mode", label: "Help mode — explain this page", group: "Help", href: "?help=1", hint: "?" },
];

const STAFF_COMMANDS: Command[] = [
  { id: "my", label: "My shifts / request time off", group: "Do", href: "/my" },
  ...HELP_COMMANDS,
  { id: "tour-counting", label: "Start tour · Counting & waste", group: "Help", href: "/help?tour=counting" },
  { id: "count", label: "Start a count", group: "Do", href: "/count" },
  { id: "waste", label: "Log waste", group: "Do", href: "/waste" },
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
    { id: "go-brief", label: "Weekly brief", group: "Go to", href: "/brief" },
    { id: "go-schedule", label: "Schedule", group: "Go to", href: "/schedule" },
    { id: "go-tips", label: "Tips", group: "Go to", href: "/tips" },
    { id: "do-requests", label: "Approve time off & swaps", group: "Do", href: "/schedule/requests" },
    { id: "go-invoices", label: "Invoices", group: "Go to", href: "/invoices" },
    { id: "do-invoice", label: "Add a supplier invoice", group: "Do", href: "/invoices/new", hint: "photo" },
    { id: "do-invoices-open", label: "Invoices to approve", group: "Do", href: "/invoices?status=OPEN" },
    { id: "go-pnl", label: "P&L (live prime cost)", group: "Go to", href: "/pnl" },
    { id: "go-labor", label: "Timecards", group: "Go to", href: "/labor" },
    { id: "go-team", label: "Team & positions", group: "Go to", href: "/team" },
    { id: "go-reviews", label: "Reviews", group: "Go to", href: "/reviews" },
    { id: "go-budgets", label: "Budgets & targets", group: "Go to", href: "/budgets" },
    { id: "do-payroll", label: "Download payroll CSV (this week)", group: "Do", href: "/labor/payroll", hint: "csv" },
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
  const commands = session.role === "MANAGER" ? await managerCommands() : STAFF_COMMANDS;
  return (
    <ConfirmProvider>
    <div className="min-h-dvh">
      <Nav role={session.role} name={session.name} logout={signOut} />
      <CommandPalette commands={commands} />
      <HelpProvider userId={session.userId} />
      <main className="pb-[var(--tabbar)] lg:pl-60 lg:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-12">{children}</div>
      </main>
    </div>
    </ConfirmProvider>
  );
}
