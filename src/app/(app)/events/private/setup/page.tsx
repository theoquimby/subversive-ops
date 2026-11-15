import { HelpZone } from "@/components/help";
import { PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { getPrivateEventConfig, quoteCatalog } from "@/server/services/privateEvents";
import { DefaultsCard, PackagesEditor, SpacesEditor } from "./setup-client";

export const metadata = { title: "Packages & defaults" };

export default async function PrivateEventsSetup() {
  await requireUser("MANAGER");
  const [cfg, catalog, recipes] = await Promise.all([
    getPrivateEventConfig(),
    quoteCatalog(),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "PREP"] } }, select: { id: true, name: true, kind: true, category: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        help="events.private.setup"
        back={{ href: "/events/private", label: "Private events" }}
        title="Packages & defaults"
        description="Per-person packages, your spaces, and the tax, service charge and deposit every new quote starts with."
      />
      <HelpZone id="events.private.packages" tour="private.packages">
        <Section title="Packages" description="Priced per guest. Add the recipes in each one so the quote shows real food cost and the prep list knows what to make.">
          <PackagesEditor packages={catalog.allPackages} recipes={recipes.map((r) => ({ value: r.id, label: r.name, group: r.kind === "PREP" ? "Prep recipes" : r.category || "Menu" }))} />
        </Section>
      </HelpZone>
      <div className="grid gap-6 lg:grid-cols-2">
        <HelpZone id="events.private.spaces">
          <Section title="Spaces" description="Where parties happen. A buyout closes the place to the public, which the forecast treats differently.">
            <SpacesEditor spaces={cfg.spaces} />
          </Section>
        </HelpZone>
        <HelpZone id="events.private.defaults">
          <Section title="New quote defaults" description="Changing these doesn't touch quotes already made.">
            <DefaultsCard cfg={cfg} />
          </Section>
        </HelpZone>
      </div>
    </>
  );
}
