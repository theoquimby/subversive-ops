import { Badge, Button, Card, Input, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { env, squareConfigured } from "@/server/env";
import { targetFoodCost } from "@/server/services/insights";
import { relativeTime } from "@/lib/format";
import { lastSquareSync } from "@/server/services/sales";
import { loadDemoData, resetPin, saveTarget, toggleUser } from "./actions";
import { AddUserForm, ClearDataForm, SupplierForm } from "./forms";
import { LinkButton } from "@/components/ui";
import { LaborRulesForm } from "@/app/(app)/labor/rules-form";
import { getLaborRules } from "@/server/services/labor-rules";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const me = await requireUser("MANAGER");
  const { welcome } = await searchParams;
  const empty = (await db.ingredient.count()) === 0 && (await db.recipe.count()) === 0;
  const [users, suppliers, target, lastSync] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    targetFoodCost(),
    lastSquareSync(),
  ]);

  return (
    <>
      <PageHeader title="Settings" />

      {(welcome || empty) && (
        <Card className="mb-10 p-5">
          <div className="text-base font-semibold">{welcome ? "You're in. " : ""}Let's get your data in</div>
          <p className="mt-1 text-sm text-muted">Import your existing spreadsheet (ingredients, prices and recipes), or load demo data to look around first.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/import" variant="primary">Import your sheets</LinkButton>
            {empty && <form action={loadDemoData}><Button>Load demo data</Button></form>}
          </div>
        </Card>
      )}

      <Section title="Team" description="Staff sign in with their name and PIN and only see counts and waste.">
        <Card className="divide-y divide-border">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={u.active ? "font-medium" : "text-muted line-through"}>{u.name}</span>
                <Badge>{u.role === "MANAGER" ? "Manager" : "Staff"}</Badge>
                {u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="warn">Locked</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <form action={resetPin.bind(null, u.id)} className="flex items-center gap-1.5">
                  <Input name="pin" inputMode="numeric" pattern="\d{4,8}" placeholder="New PIN" className="h-8 w-28" aria-label={`New PIN for ${u.name}`} required />
                  <Button size="sm">Reset PIN</Button>
                </form>
                {u.id !== me.userId && (
                  <form action={toggleUser.bind(null, u.id)}><Button size="sm" variant="ghost">{u.active ? "Deactivate" : "Reactivate"}</Button></form>
                )}
              </div>
            </div>
          ))}
          <AddUserForm />
        </Card>
      </Section>

      <Section title="Suppliers" description="Delivery days and lead time decide when orders are due and how many days each order covers.">
        <div className="space-y-3">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <SupplierForm v={{ id: s.id, name: s.name, kind: s.kind, email: s.email ?? "", leadTimeDays: s.leadTimeDays, minOrder: s.minOrder?.toString() ?? "", deliveryDays: s.deliveryDays }} />
            </Card>
          ))}
          <Card className="border-dashed">
            <SupplierForm v={{ id: null, name: "", kind: "LOCAL", email: "", leadTimeDays: 1, minOrder: "", deliveryDays: [] }} />
          </Card>
        </div>
      </Section>

      <Section title="Food cost target" description="Default for every menu item; individual items can override it.">
        <Card className="p-4">
          <form action={saveTarget} className="flex items-center gap-2">
            <Input name="target" type="number" min={1} max={99} step="0.5" defaultValue={Math.round(target * 1000) / 10} className="num w-24 text-right" aria-label="Target food cost percent" />
            <span className="text-sm text-muted">%</span>
            <Button>Save</Button>
          </form>
        </Card>
      </Section>

      <Section title="Labor rules" description="Pre-filled for New York; the app applies whatever is set here. Check them against current law.">
        <Card><LaborRulesForm rules={await getLaborRules()} /></Card>
      </Section>

      <Section title="Data" description="Clearing removes every ingredient, price, recipe, sale, count and order — handy after trying the demo. Logins are kept.">
        <Card className="p-4"><ClearDataForm /></Card>
      </Section>

      <Section title="Square">
        <Card className="flex items-center justify-between p-4 text-sm">
          <div>
            <div className="font-medium">{squareConfigured() ? "Connected" : "Not connected"}</div>
            <div className="text-muted">
              {squareConfigured() ? `${env.SQUARE_ENVIRONMENT} · location ${env.SQUARE_LOCATION_ID} · last sync ${relativeTime(lastSync)}` : "Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in the Vercel project's environment variables."}
            </div>
          </div>
          <Badge tone={squareConfigured() ? "good" : "warn"}>{squareConfigured() ? "Live" : "Setup needed"}</Badge>
        </Card>
      </Section>
    </>
  );
}
