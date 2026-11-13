"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { Button, Card, LinkButton } from "@/components/ui";
import { Camera, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { draftEmptyRecipes } from "../drafts/actions";

/** Shown on a recipe with no ingredients (or a new one): draft it instead of typing every line. */
export function DraftStart({ recipeId }: { recipeId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <HelpZone id="menu.drafts.start" className="mb-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-center gap-1.5 font-medium">No ingredients yet <HelpTip id="menu.drafts.start" /></div>
          <p className="text-muted">{error ?? (recipeId ? "Draft them from your most similar recipe, or read a recipe card or your notes. You check it before it's saved." : "Read a recipe card or your notes instead of typing each line.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={recipeId ? `/menu/drafts?for=${recipeId}` : "/menu/drafts"}><Camera className="size-4" />Photo or notes</LinkButton>
          {recipeId && (
            <Button variant="primary" disabled={pending} onClick={() => start(async () => {
              const r = await draftEmptyRecipes([recipeId]);
              if (r.error) setError(r.error);
              else router.push("/menu/drafts");
            })}><Sparkles className="size-4" />{pending ? "Drafting…" : "Draft ingredients"}</Button>
          )}
        </div>
      </Card>
    </HelpZone>
  );
}
