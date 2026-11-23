import { HelpTip, HelpZone } from "@/components/help";
import { Card } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { hourLabel } from "@/domain/morningBrief";
import { coversForecast } from "@/server/services/covers";
import { milestones, recentShoutouts } from "@/server/services/recognition";
import { businessToday } from "@/server/services/sales";
import { db } from "@/server/db";
import { HeartHandshake, MessageCircle, Users } from "lucide-react";
import Link from "next/link";

/**
 * The brief's people line-up: covers expected today (with the rush), milestones
 * worth a word at pre-shift, the latest shout-outs, and staff messages waiting.
 */
export async function TeamCard() {
  const today = businessToday();
  const [fc, ms, shouts, unread] = await Promise.all([
    coversForecast([today]).then((f) => f[0] ?? null).catch(() => null),
    milestones(addDays(today, -1), addDays(today, 2)).catch(() => []),
    recentShoutouts({ days: 3, limit: 3 }).catch(() => []),
    db.staffMessage.count({ where: { readAt: null } }).catch(() => 0),
  ]);
  const covers = fc?.covers != null && fc.covers >= 1 ? fc : null;
  if (!covers && ms.length === 0 && shouts.length === 0 && unread === 0) return null;
  return (
    <HelpZone id="brief.team">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 sm:px-6">
          <span className="flex items-center gap-2 text-[0.95rem] font-semibold"><Users aria-hidden className="size-4 text-area" strokeWidth={1.75} /> Guests &amp; team <HelpTip id="brief.team" /></span>
          <Link href="/team/recognition" className="relative text-xs text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">Shout-outs →</Link>
        </div>
        <ul className="divide-y divide-border px-5 pb-3 text-sm sm:px-6">
          {covers && (
            <li className="py-2.5">
              <span className="num text-lg font-semibold">{Math.round(covers.covers!)}</span> <span className="text-muted">covers expected</span>
              {covers.peak && <span className="text-ink-2"> · rush {hourLabel(covers.peak.from)}–{hourLabel(covers.peak.to)} (~{Math.round(covers.peak.covers)})</span>}
            </li>
          )}
          {ms.map((m, i) => (
            <li key={`m${i}`} className="flex items-center gap-2 py-2.5"><HeartHandshake aria-hidden className="size-4 shrink-0 text-good" /> <span>{m.title}{m.date === today ? ", today" : ""}. <span className="text-muted">Worth a word at pre-shift.</span></span></li>
          ))}
          {shouts.map((s) => (
            <li key={s.id} className="py-2.5"><span className="font-medium">{s.to.split(" ")[0]}:</span> <span className="text-ink-2">{s.body}</span> <span className="text-xs text-muted">· {s.from}</span></li>
          ))}
          {unread > 0 && (
            <li className="py-2.5"><Link href="/team/messages" className="flex items-center gap-2 font-medium text-ink-2"><MessageCircle aria-hidden className="size-4 shrink-0" /> {unread} message{unread === 1 ? "" : "s"} from the team to read</Link></li>
          )}
        </ul>
      </Card>
    </HelpZone>
  );
}
