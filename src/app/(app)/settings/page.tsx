import { HelpZone } from "@/components/help";
import { Badge, Button, Card, Input, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { targetFoodCost } from "@/server/services/insights";
import { relativeTime } from "@/lib/format";
import { squareStatus } from "@/server/services/square";
import { secretStatus } from "@/server/services/secrets";
import { ChevronRight, Plug } from "lucide-react";
import Link from "next/link";
import { lastSquareSync } from "@/server/services/sales";
import { loadDemoData, resetPin, saveTarget, toggleUser } from "./actions";
import { AddUserForm, ClearDataForm, SupplierForm } from "./forms";
import { LinkButton } from "@/components/ui";
import { LaborRulesForm } from "@/app/(app)/labor/rules-form";
import { getLaborRules, wageReview } from "@/server/services/labor-rules";
import { NY_UPSTATE_WAGES } from "@/domain/wageRules";
import { WageReview } from "./wage-review";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const me = await requireUser("MANAGER");
  const { welcome } = await searchParams;
  const empty = (await db.ingredient.count()) === 0 && (await db.recipe.count()) === 0;
  const [users, suppliers, target, lastSync, square, secrets, placeId] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    targetFoodCost(),
    lastSquareSync(),
    squareStatus(),
    secretStatus(),
    db.setting.findUnique({ where: { key: "reviews.googlePlaceId" } }),
  ]);
  const has = (n: string) => secrets.some((x) => x.name === n && x.set);
  const linked = [
    square.connected,
    has("RESEND_API_KEY") && has("EMAIL_FROM"),
    has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY"),
    has("ANTHROPIC_API_KEY"),
    has("GOOGLE_PLACES_API_KEY") && !!placeId,
  ].filter(Boolean).length;

  return (
    <>
      <PageHeader help="settings.page" title="Settings" />

      {(welcome || empty) && (
        <HelpZone id="settings.getStarted" className="mb-10"><Card className="p-5">
          <div className="text-base font-semibold">{welcome ? "You're in. " : ""}Let's get your data in</div>
          <p className="mt-1 text-sm text-muted">Import your existing spreadsheet (ingredients, prices and recipes), or load demo data to look around first.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/import" variant="primary">Import your sheets</LinkButton>
            {empty && <form action={loadDemoData}><Button>Load demo data</Button></form>}
          </div>
        </Card></HelpZone>
      )}

      <HelpZone id="settings.connections" className="mb-3"><Link href="/settings/connections" className="group block" data-tour="settings.connections">
        <Card className="flex items-center justify-between gap-3 p-5 transition-colors group-hover:border-border-strong">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[0.65rem] bg-area/10 text-area ring-1 ring-area/15 ring-inset"><Plug className="size-[1.1rem]" strokeWidth={1.9} /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">Connections</span>
                <Badge tone={linked === 5 ? "good" : linked ? "neutral" : "warn"}>{linked} of 5 on</Badge>
              </div>
              <div className="mt-1 text-sm text-muted">Square, email, phone notifications, AI features and Google reviews — each with a step-by-step guide.</div>
            </div>
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted group-hover:text-ink" />
        </Card>
      </Link></HelpZone>
      <HelpZone id="settings.notifications" className="mb-3"><Link href="/settings/notifications" className="group block">
        <Card className="flex items-center justify-between gap-3 p-5 transition-colors group-hover:border-border-strong">
          <div className="min-w-0">
            <div className="text-base font-semibold">Notifications</div>
            <div className="mt-1 text-sm text-muted">Email and phone alerts — schedules, orders, price spikes, the weekly brief.</div>
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted group-hover:text-ink" />
        </Card>
      </Link></HelpZone>
      <HelpZone id="settings.square" className="mb-10"><Link href="/settings/square" className="group block">
        <Card className="flex items-center justify-between gap-3 p-5 transition-colors group-hover:border-border-strong">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">Square</span>
              <Badge tone={square.connected ? "good" : "warn"}>{square.connected ? "Live" : "Setup needed"}</Badge>
              {square.connected && square.environment === "sandbox" && <Badge tone="warn">Test account</Badge>}
            </div>
            <div className="mt-1 text-sm text-muted">
              {square.connected
                ? `${square.merchantName ?? "Connected"} · ${square.selectedCount} location${square.selectedCount === 1 ? "" : "s"} · last sync ${relativeTime(lastSync)}`
                : "Connect Square to bring in sales, the menu and timecards. The guide is under Connections."}
            </div>
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted group-hover:text-ink" />
        </Card>
      </Link></HelpZone>

      <Section help="settings.team" title="Team" description="Staff sign in with their name and PIN. They see their shifts, counts, waste and help.">
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
                  <Input name="pin" inputMode="numeric" pattern="\d{4,8}" placeholder="New PIN" className="h-10 sm:h-8 w-28" aria-label={`New PIN for ${u.name}`} required />
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

      <div id="suppliers" className="scroll-mt-20" />
      <Section help="settings.suppliers" title="Suppliers" description="Delivery days and lead time decide when orders are due and how many days each order covers.">
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

      <Section help="settings.target" title="Food cost target" description="Default for every menu item; individual items can override it.">
        <Card className="p-4">
          <form action={saveTarget} className="flex items-center gap-2">
            <Input name="target" type="number" min={1} max={99} step="0.5" defaultValue={Math.round(target * 1000) / 10} className="num w-24 text-right" aria-label="Target food cost percent" />
            <span className="text-sm text-muted">%</span>
            <Button>Save</Button>
          </form>
        </Card>
      </Section>

      <Section help="settings.laborRules" title="Labor rules" description="Pre-filled for New York; the app applies whatever is set here. Check them against current law.">
        <Card>
          <HelpZone id="settings.wageSchedule"><WageReview {...await wageReview()} table={NY_UPSTATE_WAGES} /></HelpZone>
          <LaborRulesForm rules={await getLaborRules()} />
        </Card>
      </Section>

      <Section help="settings.clear" title="Data" description="Clearing removes every ingredient, price, recipe, sale, count and order — handy after trying the demo. Logins are kept.">
        <Card className="p-4"><ClearDataForm /></Card>
      </Section>

    </>
  );
}
