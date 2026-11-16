import { Badge, Card, cx, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { daysBetween } from "@/domain/dates";
import { money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { batchDetail } from "@/server/services/brewery";
import { fillHref } from "@/server/services/breweryWrite";
import Link from "next/link";
import { notFound } from "next/navigation";
import { abvText, bblText, beerFill, gravityIn, KIND_LABEL, StatusBadge } from "../../bits";
import { BatchDetails, BatchEnd, GravityPanel, History, PlanDates, SplitForm, SplitLinks, StayRow } from "./batch-client";

export const metadata = { title: "Brew" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const d = await batchDetail(id);
  if (!d) notFound();
  const b = d.batch;
  const inTank = d.stays.find((s) => s.current);
  const sub = [
    b.status === "PLANNED" && b.plannedOn ? `Planned for ${shortDate(b.plannedOn)}` : b.brewedOn ? `Brewed ${shortDate(b.brewedOn)}` : null,
    inTank ? `in ${inTank.tankName} since ${shortDate(inTank.start)}` : null,
    b.packagedOn ? `packaged ${shortDate(b.packagedOn)}` : null,
    b.dumped ? `dumped ${shortDate(b.dumped.on)}: ${b.dumped.reason}` : null,
    b.recipeName && b.recipeName !== b.name ? `recipe ${b.recipeName}` : null,
  ].filter(Boolean).join(" · ");

  // The path as one bar: each stay's share of the brew's days so far (planned ones faded).
  const ends = d.stays.map((s) => s.end ?? (s.current ? d.today : s.start));
  const first = d.stays[0]?.start;
  const last = ends.reduce((m, e) => (e > m ? e : m), first ?? d.today);
  const total = first ? Math.max(1, daysBetween(first, last)) : 1;
  const fill = beerFill(b.color);
  const live = b.status === "PLANNED" || b.status === "FERMENTING" || b.status === "CONDITIONING";
  const kegs = (b.halfKegs ?? 0) + (b.sixthKegs ?? 0);
  const made = [b.halfKegs ? `${b.halfKegs} × ½ bbl` : null, b.sixthKegs ? `${b.sixthKegs} × ⅙ bbl` : null, b.cases ? `${b.cases} case${b.cases === 1 ? "" : "s"} of cans` : null, b.co2Vols ? `${b.co2Vols} vols CO₂` : null].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        help="brewery.batches.one"
        back={{ href: "/brewery/batches", label: "Brews" }}
        title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{b.name}<span className="num text-lg font-normal text-muted">{b.code}</span><StatusBadge status={b.status} /></span>}
        description={sub || undefined}
        actions={
          inTank ? <LinkButton href={`/brewery#tank-${inTank.tankId}`}>Open {inTank.tankName}</LinkButton>
          : b.status === "PLANNED" ? <LinkButton href={`/brewery/brew/new?batch=${b.id}`} variant="primary">Start brew day</LinkButton>
          : undefined
        }
      />
      <SplitLinks from={b.splitFrom} into={b.splits} />

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Volume" value={bblText(b.bbl)} hint={b.bbl ? `about ${Math.round(b.bbl * 248)} pints` : undefined} />
        <Stat label="ABV" value={abvText(b.abv)} hint={`OG ${gravityIn(b.og, d.unit)} · FG ${gravityIn(b.fg, d.unit)}`} />
        <Stat label="Ingredient cost" value={b.cost != null ? money(b.cost, { whole: true }) : "Not known yet"} hint={b.cost != null ? "Worked out on brew day" : b.status === "PLANNED" ? "Worked out on brew day" : "Type it in below if you know it"} />
        <Stat label="Cost per pint" value={b.costPerPint != null ? money(b.costPerPint) : "—"} hint="Ingredients only" />
      </div>

      {live && (
        <Section title="Planned days" description="Dry hop and release from its timing; transfers and packaging are the tank dates below.">
          <PlanDates batch={b} today={d.today} />
        </Section>
      )}

      <Section title="Through the tanks" description={d.stays.length ? "Change a date and the plan and the brew's dates follow." : undefined}>
        {d.stays.length ? (
          <>
            <div className="mb-3 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={d.stays.map((s) => `${s.tankName} ${s.days ?? "?"} days`).join(", ")}>
              {d.stays.map((s, i) => (
                <div key={s.id} className={cx("h-full", s.planned && "opacity-40")} style={{ flexGrow: Math.max(1, daysBetween(s.start, ends[i])), flexBasis: 0, background: s.kind === "FERMENTER" ? fill.bg : `color-mix(in oklab, ${fill.bg} 55%, var(--surface))` }} />
              ))}
            </div>
            <p className="num mb-3 text-xs text-muted">{total} days from first tank to {b.packagedOn ? "packaging" : inTank ? "today" : "the last planned day"}</p>
            <Card>
              <ul className="divide-y divide-border">
                {d.stays.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <StayRow stay={s} kindLabel={KIND_LABEL[s.kind]} today={d.today} />
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : (
          <Card className="px-4 py-3.5 text-sm text-muted">Not in any tank. Plan it on the schedule, or brew into a tank from the Tanks page.</Card>
        )}
      </Section>

      {d.timeline.length > 0 && (
        <Section title="History" description="Moves, stage changes, packaging and splits, with the gravity and notes taken.">
          <History entries={d.timeline} />
        </Section>
      )}

      <Section title="Gravity">
        <GravityPanel batchId={b.id} readings={d.readings} today={d.today} unit={d.unit} />
      </Section>

      <Section title="Kegs" description={d.kegBatch ? undefined : b.status === "PACKAGED" ? "Packaged before keg batches were linked." : "When it's packaged, a keg batch with this brew's code is made for filling kegs."}>
        {(made || d.packageNote) && (
          <Card className="mb-3 p-4">
            <div className="text-sm"><span className="text-muted">Packaging made </span><span className="num font-medium">{made || "—"}</span></div>
            {d.packageNote && <p className="mt-1 text-sm text-ink-2">{d.packageNote}</p>}
          </Card>
        )}
        {d.kegBatch ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm">Keg batch <span className="num font-semibold">{d.kegBatch.code}</span>{d.kegBatch.packagedOn ? <span className="text-muted"> · packaged {shortDate(d.kegBatch.packagedOn)}</span> : null}</div>
              <div className="num text-sm text-muted">{d.kegBatch.filled} keg{d.kegBatch.filled === 1 ? "" : "s"} filled{kegs ? ` of ${kegs}` : ""}{d.kegBatch.bySize.length ? ` · ${d.kegBatch.bySize.map((x) => `${x.n} ${x.label}`).join(", ")}` : ""}</div>
            </div>
            {kegs > d.kegBatch.filled && (
              <LinkButton href={fillHref({ beerId: b.beerId, code: d.kegBatch.code })} variant="primary" className="mt-3 h-11 sm:h-9">Fill {kegs - d.kegBatch.filled} keg{kegs - d.kegBatch.filled === 1 ? "" : "s"}</LinkButton>
            )}
            {d.kegBatch.filled === 0 ? (
              <p className="mt-2 text-sm text-muted">No kegs filled from it yet. When you fill one, pick batch <span className="num font-medium text-ink">{d.kegBatch.code}</span>.</p>
            ) : (
              <>
                {d.kegBatch.now.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {d.kegBatch.now.map((x) => <Badge key={x.label}>{x.n} {x.label.toLowerCase()}</Badge>)}
                  </div>
                )}
                <ul className="mt-3 grid gap-x-4 sm:grid-cols-2">
                  {d.kegBatch.kegs.map((k) => (
                    <li key={k.code + (k.filledOn ?? "")}>
                      <Link href={`/kegs/k/${k.code}`} className="flex min-h-10 items-center gap-2 border-b border-border py-1.5 text-sm hover:bg-surface-2/60">
                        <span className="num w-20 shrink-0 font-medium">{k.display}</span>
                        <span className="w-10 shrink-0 text-xs text-muted">{k.size}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{k.holding ? `${k.status} · ${k.place}` : "emptied since"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        ) : null}
      </Section>

      {live && (b.plannedOn || b.brewedOn) && (
        <Section title="Split" className="scroll-mt-24" description="A split brew becomes its own brew with its own beer, fermenter and dates.">
          <div id="split" className="scroll-mt-24">
            <SplitForm batch={b} today={d.today} recipes={d.recipes} beers={d.beers} choices={d.splitTo} brewOn={(b.brewedOn ?? b.plannedOn)!} />
          </div>
        </Section>
      )}

      <Section title="Details">
        <BatchDetails batch={b} recipes={d.recipes} beers={d.beers} unit={d.unit} />
      </Section>

      <BatchEnd batch={b} today={d.today} />
    </>
  );
}
