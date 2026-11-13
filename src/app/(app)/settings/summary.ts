import "server-only";
import { DEFAULT_BEV_TARGET } from "@/domain/revenueClass";
import { fixedTotal } from "@/domain/analytics";
import { RANGE_PRESETS } from "@/domain/lab";
import { RULE_IDS } from "@/domain/labor";
import { monthDayLabel, summarizeWeek } from "@/domain/openingHours";
import { money } from "@/lib/format";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { loadAccounts, loadTaxRate } from "@/server/services/accounting";
import { getFixedCosts, getRange } from "@/server/services/analytics";
import { location } from "@/server/services/forecasting";
import { classSettings, targetFoodCost } from "@/server/services/insights";
import { storageAreasWithCounts } from "@/server/services/inventory";
import { autoApproveEnabled, loadTolerance, pricesOnApproveEnabled } from "@/server/services/invoices";
import { getLaborRules, getRegularHours, getSeasonalHours, wageAutoOn } from "@/server/services/labor-rules";
import { spikeThreshold } from "@/server/services/notify";
import { quickbooksStatus } from "@/server/services/quickbooks";
import { reviewSettings } from "@/server/services/reviews";
import { getAutoDraft } from "@/server/services/scheduling";
import { secretStatus } from "@/server/services/secrets";
import { defaultLaborPct, getBusinessContact } from "@/server/services/settings";
import { squareStatus } from "@/server/services/square";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pctShort = (f: number) => `${Math.round(f * 1000) / 10}%`;

/** The current value of every setting on the Settings home, keyed by registry item id. */
export async function settingsSummary(): Promise<{ values: Record<string, string>; connected: number; connectionsTotal: number }> {
  const [contact, regular, seasons, loc, users, positions, rules, wageAuto, laborDefault, autoDraft, food, cls, spike, suppliers, areas, tax, tol, auto, accounts, fixed, range, reviews, square, qbo, secrets] = await Promise.all([
    getBusinessContact(),
    getRegularHours(),
    getSeasonalHours(),
    location(),
    db.user.findMany({ where: { active: true }, select: { role: true } }),
    db.position.count(),
    getLaborRules(),
    wageAutoOn(),
    defaultLaborPct(),
    getAutoDraft(),
    targetFoodCost(),
    classSettings(),
    spikeThreshold(),
    db.supplier.count({ where: { active: true } }),
    storageAreasWithCounts(),
    loadTaxRate(),
    loadTolerance(),
    autoApproveEnabled(),
    loadAccounts(),
    getFixedCosts(),
    getRange(),
    reviewSettings(),
    squareStatus(),
    quickbooksStatus(),
    secretStatus(),
  ]);
  const has = (n: string) => secrets.some((x) => x.name === n && x.set);
  const links = [square.connected, has("RESEND_API_KEY") && has("EMAIL_FROM"), has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY"), has("ANTHROPIC_API_KEY"), has("GOOGLE_PLACES_API_KEY") && !!reviews.placeId, qbo.connected];
  const connected = links.filter(Boolean).length;
  const managers = users.filter((u) => u.role === "MANAGER").length;
  const changedChecks = RULE_IDS.filter((id) => rules.ruleSettings?.[id]?.on === false).length;
  const fixedSum = fixedTotal(fixed);

  const values: Record<string, string> = {
    "business.profile": [contact.name, contact.address ? contact.address.split(",")[0] : "no address yet"].join(" · "),
    "business.hours": summarizeWeek(regular),
    "business.seasons": seasons.length ? seasons.map((s) => `${s.label} (${monthDayLabel(s.from)}–${monthDayLabel(s.to)})`).join(", ") : "None",
    "business.weather": loc.label,
    "business.timezone": env.BUSINESS_TIMEZONE.replace("America/New_York", "Eastern (New York)").replace(/_/g, " "),
    "people.logins": `${plural(users.length, "person", "people")} · ${plural(managers, "manager")}`,
    "people.access": "Staff: shifts, counts, waste, help",
    "people.positions": plural(positions, "position"),
    "pay.wage": `${wageAuto ? "NY schedule" : "Your rate"} · ${money(rules.minimumWage)}`,
    "pay.overtime": `After ${rules.weeklyOvertimeHours}h · ${rules.overtimeMultiplier}×`,
    "pay.breaks": `${rules.mealBreakMinutes} min after ${rules.mealBreakAfterHours}h`,
    "pay.period": rules.payPeriod === "BIWEEKLY" ? "Every two weeks" : "Weekly",
    "pay.sick": `1h per ${rules.sickHoursWorkedPerHour}h · ${rules.sickAnnualCapHours}h a year`,
    "pay.checks": changedChecks ? `${RULE_IDS.length - changedChecks} on · ${changedChecks} off` : `All ${RULE_IDS.length} on`,
    "pay.laborTarget": laborDefault == null ? "Weekly budgets only" : pctShort(laborDefault),
    "pay.autoDraft": autoDraft ? "On" : "Off",
    "food.target": pctShort(food),
    "food.bevTarget": pctShort(cls.bevTarget ?? DEFAULT_BEV_TARGET),
    "food.spike": `${pctShort(spike)} or more`,
    "food.suppliers": plural(suppliers, "supplier"),
    "food.areas": plural(areas.length, "area"),
    "money.tax": tax == null ? "From Square" : `${Number((tax * 100).toFixed(3))}%`,
    "money.tolerance": `${money(tol.price)} price · ${tol.qty} qty`,
    "money.autoApprove": auto ? "On" : "Off",
    "money.pricesOnApprove": (await pricesOnApproveEnabled()) ? "On" : "Off",
    "money.terms": accounts.termsDays === 0 ? "Due on receipt" : `Net ${accounts.termsDays}`,
    "money.fixed": fixedSum > 0 ? `${money(fixedSum, { whole: true })} a month` : "Not set",
    "insights.range": RANGE_PRESETS.find((p) => p.id === range)?.label ?? range,
    "insights.tone": reviews.toneNotes ? "Your notes" : "Default voice",
    "conn.all": `${connected} of ${links.length} on`,
    "conn.square": square.connected ? `Live${square.merchantName ? ` · ${square.merchantName}` : ""}` : "Not connected",
    "conn.qbo": qbo.connected ? `Live${qbo.companyName ? ` · ${qbo.companyName}` : ""}` : "Not set up",
  };
  return { values, connected, connectionsTotal: links.length };
}
