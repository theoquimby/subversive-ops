import { Badge, Button, Card, Input, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { env, squareConfigured } from "@/server/env";
import { targetFoodCost } from "@/server/services/insights";
import { relativeTime } from "@/lib/format";
import { lastSquareSync } from "@/server/services/sales";
import { resetPin, saveTarget, toggleUser } from "./actions";
import { AddUserForm, SupplierForm } from "./forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser("MANAGER");
  const [users, suppliers, target, lastSync] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    targetFoodCost(),
    lastSquareSync(),
  ]);

  return (
    <>
      <PageHeader title="Settings" />

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
