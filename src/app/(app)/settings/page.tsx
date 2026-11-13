import { HelpZone } from "@/components/help";
import { Button, Card, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadDemoData } from "./actions";
import { SettingsIndex } from "./settings-index";
import { settingsSummary } from "./summary";
import { pendingSuggestions } from "@/server/services/learned";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  await requireUser("MANAGER");
  const { welcome } = await searchParams;
  const [ingredients, recipes, { values }, learned] = await Promise.all([db.ingredient.count(), db.recipe.count(), settingsSummary(), pendingSuggestions()]);
  const empty = ingredients === 0 && recipes === 0;

  return (
    <div className="max-w-3xl">
      <PageHeader help="settings.page" title="Settings" description="Everything you set once and rarely touch. Each line shows what it's set to now." />

      {(welcome || empty) && (
        <HelpZone id="settings.getStarted" className="mb-8"><Card className="p-5">
          <div className="text-base font-semibold">{welcome ? "You're in. " : ""}Let's get your data in</div>
          <p className="mt-1 text-sm text-muted">Import your existing spreadsheet (ingredients, prices and recipes), or load demo data to look around first.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/import" variant="primary">Import your sheets</LinkButton>
            {empty && <form action={loadDemoData}><Button>Load demo data</Button></form>}
          </div>
        </Card></HelpZone>
      )}

      <SettingsIndex values={values} suggestions={learned.counts} />
    </div>
  );
}
