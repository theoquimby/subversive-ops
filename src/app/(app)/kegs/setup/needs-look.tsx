"use client";

import { Button, Card, Select } from "@/components/ui";
import type { NeedsALook } from "@/server/services/beerLinks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setBeerField, setSquareItemBeerAction } from "../actions";
import { setBeerBoardField } from "../taps/actions";
import { joinKegBatchAction, takeRecipeBeerAction } from "./needs-actions";

type Result = { error?: string; ok?: string } | void;

/** One fix button (or picker) with its own pending state and error. */
function useFix() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      const r = await fn().catch(() => ({ error: "Couldn't save. Check the connection and try again." }));
      if (r && r.error) setError(r.error);
      else router.refresh();
    });
  return { pending, error, run };
}

function Row({ title, detail, children }: { title: React.ReactNode; detail?: React.ReactNode; children?: (fix: ReturnType<typeof useFix>) => React.ReactNode }) {
  const fix = useFix();
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {detail && <div className="text-xs text-muted">{detail}</div>}
        {fix.error && <div className="text-xs text-bad">{fix.error}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:max-w-[60%] sm:justify-end">{children(fix)}</div>}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 mt-5 first:mt-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted">{hint}</div>
      </div>
      <Card className="divide-y divide-border">{children}</Card>
    </div>
  );
}

const btn = "h-10 sm:h-8";

/**
 * Beers, Square items, keg batches and brews that don't link up cleanly. The
 * migration and the app only link what matches exactly one thing; the rest is
 * here for a manager, with the obvious fix one tap away.
 */
export function NeedsALookList({ data }: { data: NeedsALook }) {
  const beerOptions = data.beers.map((b) => ({ value: b.id, label: b.name }));
  const kegOptions = data.kegIngredients.map((k) => ({ value: k.id, label: k.name }));
  if (data.count === 0) return <p className="text-sm text-muted">Nothing to look at: every beer, Square pour, keg batch and brew links up.</p>;
  return (
    <div>
      {data.beersNoKeg.length > 0 && (
        <Group title="Beers with no keg ingredient" hint="The keg ingredient's price is what a keg costs on the menu, the P&L and demand. Pick it, or set the beer up on Draft beer.">
          {data.beersNoKeg.map((b) => (
            <Row key={b.beerId} title={b.beer} detail={b.suggestions.length ? undefined : <>No keg ingredient looks like it. <Link href="/menu/draft-beer" className="underline underline-offset-2">Set it up on Draft beer</Link>.</>}>
              {(fix) => (
                <>
                  {b.suggestions[0] && <Button size="sm" className={btn} disabled={fix.pending} onClick={() => fix.run(() => setBeerField(b.beerId, "ingredientId", b.suggestions[0].id))}>Link {b.suggestions[0].name}</Button>}
                  {kegOptions.length > 0 && <Select className="w-56" aria-label={`Keg ingredient for ${b.beer}`} placeholder="Pick a keg ingredient" searchable options={kegOptions} value="" disabled={fix.pending} onChange={(e) => e.target.value && fix.run(() => setBeerField(b.beerId, "ingredientId", e.target.value))} />}
                </>
              )}
            </Row>
          ))}
        </Group>
      )}

      {data.squareNoBeer.length > 0 && (
        <Group title="Square pours not linked to a beer" hint="Sold in the last 90 days and look like draft beer. Linked, their sales count for that beer whatever the item is called.">
          {data.squareNoBeer.slice(0, 30).map((s) => (
            <Row key={s.squareId} title={s.name} detail={`${Math.round(s.sold90)} sold in 90 days`}>
              {(fix) => (
                <>
                  {s.suggestion && <Button size="sm" className={btn} disabled={fix.pending} onClick={() => fix.run(() => setSquareItemBeerAction(s.squareId, s.suggestion!.beerId))}>Link to {s.suggestion.beer}</Button>}
                  <Select className="w-48" aria-label={`Beer for ${s.name}`} placeholder="Pick the beer" searchable options={beerOptions} value="" disabled={fix.pending} onChange={(e) => e.target.value && fix.run(() => setSquareItemBeerAction(s.squareId, e.target.value))} />
                </>
              )}
            </Row>
          ))}
          {data.squareNoBeer.length > 30 && <div className="px-4 py-2 text-xs text-muted">And {data.squareNoBeer.length - 30} more. Link the busiest first.</div>}
        </Group>
      )}

      {data.kegBatchesNoBrew.length > 0 && (
        <Group title="Keg batches with a brew code but no brew" hint="Kegs were filled from a batch whose code looks like a brew's, but it isn't joined to one.">
          {data.kegBatchesNoBrew.map((k) => (
            <Row key={k.id} title={`Batch ${k.code}`} detail={k.brew ? `${k.beer ?? "No beer"} · brew ${k.brew.code} is ${k.brew.beer ?? "no beer yet"}` : `${k.beer ?? "No beer"} · no brew has this code`}>
              {k.brew ? (fix) => <Button size="sm" className={btn} disabled={fix.pending} onClick={() => fix.run(() => joinKegBatchAction(k.id, k.brew!.id))}>Join brew {k.brew!.code}</Button> : undefined}
            </Row>
          ))}
        </Group>
      )}

      {data.brewsOffRecipe.length > 0 && (
        <Group title="Brews saved as a different beer from their recipe" hint="A brew pours as its recipe's beer. These were saved otherwise (often by an import); nothing was changed.">
          {data.brewsOffRecipe.map((b) => (
            <Row key={b.id} title={<Link href={`/brewery/batches/${b.id}`} className="hover:underline">{b.code}</Link>} detail={`Saved as ${b.beer ?? "no beer"}; recipe ${b.recipe} pours as ${b.recipeBeer}`}>
              {(fix) => <Button size="sm" className={btn} disabled={fix.pending} onClick={() => fix.run(() => takeRecipeBeerAction(b.id))}>Make it {b.recipeBeer}</Button>}
            </Row>
          ))}
        </Group>
      )}

      {data.abvDiffers.length > 0 && (
        <Group title="ABV typed differs from the brewery's" hint="Measured from the latest packaged brew's OG and FG. The typed ABV stays on the board until you change it.">
          {data.abvDiffers.map((a) => (
            <Row key={a.beerId} title={<Link href={`/kegs/beers/${a.beerId}`} className="hover:underline">{a.beer}</Link>} detail={`Typed ${a.typed}%, measured ${a.measured}% (brew ${a.code})`}>
              {(fix) => <Button size="sm" className={btn} disabled={fix.pending} onClick={() => fix.run(() => setBeerBoardField(a.beerId, "abv", String(a.measured)))}>Use {a.measured}%</Button>}
            </Row>
          ))}
        </Group>
      )}
    </div>
  );
}
