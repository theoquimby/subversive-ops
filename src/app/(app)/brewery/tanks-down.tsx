import { Card } from "@/components/ui";
import { equipmentHref } from "@/domain/tankUpkeep";
import { shortDate } from "@/lib/format";
import { db } from "@/server/db";
import { tanksDown } from "@/server/services/tankUpkeep";
import Link from "next/link";

/**
 * Tanks down for repair (an open repair on Upkeep marked them out of
 * service): said once at the top of the floor and the schedule, with a link
 * to the repair. Read-only; nothing here moves a plan.
 */
export async function TanksDownNote() {
  const down = await tanksDown();
  if (!down.size) return null;
  const names = new Map((await db.tank.findMany({ where: { id: { in: [...down.keys()] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const rows = [...down.values()].filter((d) => names.has(d.tankId)).sort((a, b) => names.get(a.tankId)!.localeCompare(names.get(b.tankId)!));
  if (!rows.length) return null;
  return (
    <Card role="status" className="mb-6 border-bad/40 px-4 py-3 text-sm">
      <span className="font-medium text-bad">{rows.length === 1 ? `${names.get(rows[0].tankId)} is down for repair.` : `${rows.length} tanks are down for repair.`}</span>{" "}
      <span className="text-ink-2">Don&apos;t plan brews into {rows.length === 1 ? "it" : "them"} until the repair is marked fixed on Upkeep.</span>
      <ul className="mt-1.5 space-y-0.5">
        {rows.map((d) => (
          <li key={d.tankId}>
            <Link href={equipmentHref(d.equipmentId)} className="inline-flex min-h-8 items-center text-ink underline-offset-2 hover:underline">
              {names.get(d.tankId)}: {d.title}, since {shortDate(d.since)}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
