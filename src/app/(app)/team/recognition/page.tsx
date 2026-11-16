import { HelpZone } from "@/components/help";
import { Badge, Card, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { getRecognitionConfig, milestones, recentShoutouts, rewardsList } from "@/server/services/recognition";
import { shortDate } from "@/lib/format";
import { Award, CalendarHeart, Clock3, GraduationCap } from "lucide-react";
import { RecognitionSettings, RedemptionsList, RewardsEditor, ShoutoutComposer, ShoutoutFeed } from "./recognition-client";

export const metadata = { title: "Shout-outs" };

const MILESTONE_ICON = { anniversary: CalendarHeart, "first-month": Award, "perfect-attendance": Clock3, training: GraduationCap } as const;

/** Recognition: give shout-outs tied to the values, milestones worth a word, and the optional rewards list. */
export default async function RecognitionPage() {
  await requireUser("MANAGER");
  const [cfg, feed, ms, team, rewards, pending] = await Promise.all([
    getRecognitionConfig(),
    recentShoutouts({ days: 60, limit: 40, includeHidden: true }),
    milestones(),
    db.employee.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    rewardsList(true),
    db.rewardRedemption.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { reward: { select: { name: true } }, employee: { select: { name: true } } } }),
  ]);

  return (
    <>
      <PageHeader help="team.recognition" back={{ href: "/team", label: "Team" }} title="Shout-outs" description="Thank people for the things that make a shift go well. Shout-outs show on everyone's Today screen and in your morning brief." />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          <HelpZone id="team.recognition.give"><ShoutoutComposer team={team} values={cfg.values} milestones={ms.map((m) => ({ employeeId: m.employeeId, title: m.title }))} /></HelpZone>
          <ShoutoutFeed items={feed} />
        </div>
        <div className="flex flex-col gap-8">
          <HelpZone id="team.recognition.milestones">
            <section aria-labelledby="ms-h">
              <h2 id="ms-h" className="mb-3 text-[0.95rem] font-semibold">Milestones this fortnight</h2>
              {ms.length === 0 ? (
                <Card className="px-4 py-5 text-sm text-muted">Nothing this week. Anniversaries, first months, perfect attendance and finished training show up here.</Card>
              ) : (
                <Card className="divide-y divide-border">
                  {ms.map((m, i) => {
                    const Icon = MILESTONE_ICON[m.kind];
                    return (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="min-w-0 flex-1">{m.title}</span>
                        <span className="num shrink-0 text-xs text-muted">{shortDate(m.date)}</span>
                      </div>
                    );
                  })}
                </Card>
              )}
            </section>
          </HelpZone>
          {cfg.pointsEnabled && pending.length > 0 && (
            <RedemptionsList items={pending.map((p) => ({ id: p.id, who: p.employee.name, reward: p.reward.name, points: p.points, at: p.createdAt.toISOString() }))} />
          )}
        </div>
      </div>

      <Section help="team.recognition.settings" title="Settings" description="Your values, whether staff can thank each other, and points.">
        <RecognitionSettings cfg={cfg} />
      </Section>

      {cfg.pointsEnabled && (
        <Section help="team.recognition.rewards" title={<span className="inline-flex items-center gap-2">Rewards <Badge>{cfg.managerPoints} points per manager shout-out</Badge></span>} description="What points can be swapped for. Keep it small and real: a growler fill, a shift meal, first pick of the schedule.">
          <RewardsEditor rewards={rewards.map((r) => ({ id: r.id, name: r.name, description: r.description, cost: r.cost, active: r.active }))} />
        </Section>
      )}
    </>
  );
}
