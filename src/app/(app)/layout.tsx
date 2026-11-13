import { CommandPalette, type Command } from "@/components/command-palette";
import { Nav } from "@/components/nav";
import { logout, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { redirect } from "next/navigation";

const STAFF_COMMANDS: Command[] = [
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
    { id: "go-ingredients", label: "Ingredients", group: "Go to", href: "/ingredients" },
    { id: "go-prices", label: "Prices", group: "Go to", href: "/prices" },
    { id: "go-ordering", label: "Ordering", group: "Go to", href: "/ordering" },
    { id: "go-sales", label: "Sales & forecast", group: "Go to", href: "/sales" },
    { id: "go-settings", label: "Settings", group: "Go to", href: "/settings" },
    { id: "do-import", label: "Import a price sheet", group: "Do", href: "/prices/import", hint: "upload" },
    { id: "do-bulk", label: "Import ingredients & recipes from a spreadsheet", group: "Do", href: "/import", hint: "setup" },
    { id: "do-manual", label: "Update prices by hand", group: "Do", href: "/prices/update" },
    { id: "do-unlinked", label: "Link new supplier products", group: "Do", href: "/prices?filter=unlinked" },
    { id: "do-recipe", label: "New recipe", group: "Do", href: "/menu/new" },
    { id: "do-prep", label: "New prep recipe", group: "Do", href: "/menu/new?kind=PREP" },
    { id: "do-ingredient", label: "New ingredient", group: "Do", href: "/ingredients/new" },
    ...STAFF_COMMANDS,
    { id: "do-sync", label: "Sync Square / map items", group: "Do", href: "/sales" },
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
  const commands = session.role === "MANAGER" ? await managerCommands() : STAFF_COMMANDS;
  return (
    <div className="min-h-dvh">
      <Nav role={session.role} name={session.name} logout={signOut} />
      <CommandPalette commands={commands} />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-12">{children}</div>
      </main>
    </div>
  );
}
