"use client";

import { Badge, Button, Card, cx, EmptyState, Field, Input, Select } from "@/components/ui";
import { STAGES } from "@/domain/brewDay";
import { qty, shortDate } from "@/lib/format";
import type { BrewDayListItem } from "@/server/services/brewDay";
import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startBrewDayAction } from "./actions";

interface Lists {
  today: string;
  inProgress: BrewDayListItem[];
  planned: BrewDayListItem[];
  recipes: { id: string; name: string; status: string; batchBbl: number }[];
  fermenters: { id: string; name: string }[];
}

const stageLabel = (s: string | null) => STAGES.find((x) => x.id === s)?.label ?? "Mash";

export function BrewDayStart({ lists, pick }: { lists: Lists; pick: { recipeId: string | null; tankId: string | null; batchId: string | null } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recipeId, setRecipe] = useState(pick.recipeId && lists.recipes.some((r) => r.id === pick.recipeId) ? pick.recipeId : "");
  const [tankId, setTank] = useState(pick.tankId && lists.fermenters.some((t) => t.id === pick.tankId) ? pick.tankId : "");
  const recipe = lists.recipes.find((r) => r.id === recipeId);
  const [bbl, setBbl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const go = (input: Parameters<typeof startBrewDayAction>[0], key: string) =>
    start(async () => {
      setError(null);
      setBusy(key);
      const res = await startBrewDayAction(input);
      if (res.error || !res.batchId) {
        setBusy(null);
        return setError(res.error ?? "Couldn't start it.");
      }
      router.push(`/brewery/brew/${res.batchId}`);
    });

  const startNew = () => {
    const n = bbl.trim() === "" ? null : Number(bbl);
    if (n != null && !(Number.isFinite(n) && n > 0)) return setError("Batch size in barrels, like 7.");
    go({ recipeId: recipeId || null, tankId: tankId || null, bbl: n }, "new");
  };

  const highlighted = pick.batchId;
  return (
    <div className="max-w-3xl space-y-6 pb-10">
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {lists.inProgress.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-2">Going now</h2>
          <div className="space-y-2">
            {lists.inProgress.map((b) => (
              <Link key={b.id} href={`/brewery/brew/${b.id}`} className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{b.name}</span>
                  <span className="block text-sm text-muted">{b.code} · {stageLabel(b.stage)}{b.tank ? ` · into ${b.tank}` : ""}{b.startedAt ? ` · started ${new Date(b.startedAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</span>
                </span>
                <Badge tone="warn">Carry on</Badge>
                <ChevronRight className="size-5 shrink-0 text-muted" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Planned brews</h2>
        {lists.planned.length === 0 ? (
          <EmptyState title="Nothing planned for the next three weeks">Plan brews on the <Link href="/brewery/schedule" className="underline underline-offset-2">schedule</Link>, or start one from a recipe below.</EmptyState>
        ) : (
          <div className="space-y-2">
            {lists.planned.map((b) => {
              const late = b.plannedOn != null && b.plannedOn < lists.today;
              const isToday = b.plannedOn === lists.today;
              return (
                <Card key={b.id} className={cx("flex min-h-16 flex-wrap items-center gap-3 px-4 py-3", highlighted === b.id && "border-ink-2/50")}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{b.name}</span>
                    <span className="block text-sm text-muted">
                      {b.code}
                      {b.plannedOn ? ` · ${isToday ? "today" : shortDate(b.plannedOn)}` : ""}
                      {b.bbl != null ? ` · ${qty(b.bbl, 2)} bbl` : ""}
                      {b.tank ? ` · ${b.tank}` : ""}
                      {!b.recipeName && " · no recipe"}
                    </span>
                  </span>
                  {late && <Badge tone="warn">Planned earlier</Badge>}
                  <Button type="button" variant={isToday || highlighted === b.id ? "primary" : "secondary"} size="lg" className="h-12" disabled={pending} onClick={() => go({ batchId: b.id }, b.id)}>
                    <Play className="size-4" />{busy === b.id ? "Starting…" : "Start brew day"}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Start from a recipe</h2>
        <Card className="space-y-4 p-4">
          <Field label="Recipe">
            <Select
              searchable
              value={recipeId}
              onChange={(e) => setRecipe(e.target.value)}
              placeholder="Pick what you're brewing"
              options={lists.recipes.map((r) => ({ value: r.id, label: r.name, group: r.status === "dev" ? "In development" : "Live", hint: `${qty(r.batchBbl, 2)} bbl` }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fermenter" hint="Can wait until the end of the day">
              <Select value={tankId} onChange={(e) => setTank(e.target.value)} options={[{ value: "", label: "Pick later" }, ...lists.fermenters.map((t) => ({ value: t.id, label: t.name }))]} />
            </Field>
            <Field label="Batch size, bbl">
              <Input inputMode="decimal" className="num h-12 text-right text-lg sm:h-11" value={bbl} placeholder={recipe ? String(recipe.batchBbl) : "7"} onChange={(e) => setBbl(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-muted">If this recipe already has a brew day going, or a brew planned within a week, that one opens instead of a new one.</p>
          <Button type="button" variant="primary" size="lg" className="h-14 w-full text-base" disabled={pending || !recipeId} onClick={startNew}>
            <Play className="size-5" />{busy === "new" ? "Starting…" : "Start brew day"}
          </Button>
        </Card>
      </section>
    </div>
  );
}
