import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { isSquareConnected } from "@/server/services/square";
import { targetFoodCost } from "@/server/services/insights";
import { getOpeningHours } from "@/server/services/labor-rules";
import { getBusinessProfile, getOnboardingProgress, isStepId, onboardingState } from "@/server/services/onboarding";
import { Wizard } from "./wizard";

export const metadata = { title: "Set up" };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const me = await requireUser("MANAGER");
  const { step } = await searchParams;
  const [progress, state, profile, hours, target, suppliers, users, ingredients, recipes, counts, square] = await Promise.all([
    getOnboardingProgress(),
    onboardingState(),
    getBusinessProfile(),
    getOpeningHours(),
    targetFoodCost(),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, deliveryDays: true } }),
    db.user.findMany({ where: { active: true }, orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, role: true } }),
    db.ingredient.count(),
    db.recipe.count(),
    db.stockCount.count({ where: { completed: true } }),
    isSquareConnected(),
  ]);

  return (
    <Wizard
      initialStep={step && isStepId(step) ? step : progress.current}
      status={Object.fromEntries(state.steps.map((s) => [s.id, s.done ? "done" : s.skipped ? "skipped" : "todo"]))}
      me={me.name}
      profile={profile}
      hours={Object.fromEntries(Object.entries(hours).map(([d, h]) => [d, h]))}
      targetPct={Math.round(target * 1000) / 10}
      suppliers={suppliers}
      users={users.map((u) => ({ ...u, me: u.id === me.userId }))}
      data={{ ingredients, recipes }}
      square={square}
      counts={counts}
    />
  );
}
