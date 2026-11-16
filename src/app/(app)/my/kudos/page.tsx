import { HelpZone } from "@/components/help";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { balanceFor, getRecognitionConfig, recentShoutouts, rewardsList } from "@/server/services/recognition";
import { employeeForUser } from "@/server/services/scheduling";
import { Sparkles } from "lucide-react";
import { GiveShoutout, RewardsList } from "./kudos-client";

export const metadata = { title: "Shout-outs" };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/** Staff: thanks you've had, the team feed, thanking a teammate and (if on) points and rewards. */
export default async function KudosPage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  const cfg = await getRecognitionConfig();
  const [feed, mine, team, balance, rewards, asked] = await Promise.all([
    recentShoutouts({ days: 30, limit: 20 }),
    me ? recentShoutouts({ days: 365, limit: 30, employeeId: me.id }) : Promise.resolve([]),
    db.employee.findMany({ where: { active: true, ...(me ? { id: { not: me.id } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    me && cfg.pointsEnabled ? balanceFor(me.id) : Promise.resolve(0),
    cfg.pointsEnabled ? rewardsList() : Promise.resolve([]),
    me && cfg.pointsEnabled ? db.rewardRedemption.findMany({ where: { employeeId: me.id }, orderBy: { createdAt: "desc" }, take: 10, include: { reward: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const canGive = !!me && (cfg.peerShoutouts || session.role === "MANAGER");

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8">
      <PageHeader help="my.kudos" title="Shout-outs" back={{ href: "/my", label: "Today" }} description={`Thanks for the things that make a shift go well. Our values: ${cfg.values.join(" · ")}.`} />

      {canGive && (
        <HelpZone id="my.kudos.give">
          <GiveShoutout team={team} values={cfg.values} />
        </HelpZone>
      )}

      {me && (
        <section aria-labelledby="mine-h">
          <h2 id="mine-h" className="mb-2.5 flex items-center justify-between px-1 text-[0.95rem] font-semibold">
            <span>For you</span>
            {cfg.pointsEnabled && <span className="num text-sm font-medium text-ink-2">{balance} points</span>}
          </h2>
          {mine.length === 0 ? (
            <Card className="px-4 py-5 text-sm text-muted">Nothing yet — they&apos;ll land here.</Card>
          ) : (
            <Card className="divide-y divide-border">
              {mine.map((s) => (
                <article key={s.id} className="px-4 py-3.5">
                  <p className="text-[0.95rem] leading-snug text-ink">{s.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{s.value && <Badge tone="good">{s.value}</Badge>}{s.from} · {when(s.createdAt)}{s.points ? ` · +${s.points}` : ""}</p>
                </article>
              ))}
            </Card>
          )}
        </section>
      )}

      {cfg.pointsEnabled && me && (
        <HelpZone id="my.kudos.rewards">
          <RewardsList balance={balance} rewards={rewards.map((r) => ({ id: r.id, name: r.name, description: r.description, cost: r.cost }))} asked={asked.map((a) => ({ id: a.id, name: a.reward.name, points: a.points, status: a.status, at: a.createdAt.toISOString() }))} />
        </HelpZone>
      )}

      <section aria-labelledby="feed-h">
        <h2 id="feed-h" className="mb-2.5 flex items-center gap-1.5 px-1 text-[0.95rem] font-semibold"><Sparkles className="size-4 text-muted" aria-hidden /> Around the team</h2>
        {feed.length === 0 ? (
          <EmptyState title="No shout-outs this month">{canGive ? "Be the first — who made your last shift easier?" : "When managers thank someone, it shows up here."}</EmptyState>
        ) : (
          <Card className="divide-y divide-border">
            {feed.map((s) => (
              <article key={s.id} className="px-4 py-3.5">
                <p className="text-[0.95rem] leading-snug text-ink"><span className="font-medium">{s.to}</span> — {s.body}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{s.value && <Badge>{s.value}</Badge>}from {s.from} · {when(s.createdAt)}</p>
              </article>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
