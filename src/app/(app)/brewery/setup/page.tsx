import { PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { breweryDefaults, loadTanks } from "@/server/services/brewery";
import { DefaultDays, TankGrid } from "./setup-client";

export const metadata = { title: "Brewery setup" };

export default async function Page() {
  await requireUser("MANAGER");
  const [tanks, defaults] = await Promise.all([loadTanks(), breweryDefaults()]);
  return (
    <>
      <PageHeader help="brewery.setup" title="Tanks & defaults" description="Your fermenters and brite tanks with their sizes, and how long a beer usually spends in each." />
      <Section title="Tanks" description="Click a cell to change it. Order sets where a tank sits on the Tanks page and the schedule, and which is tried first when planning.">
        <TankGrid tanks={tanks} />
      </Section>
      <Section title="Usual days in tanks" description="Used when a brew has no recipe. A recipe's own days always win.">
        <DefaultDays fermentDays={defaults.fermentDays} conditionDays={defaults.conditionDays} />
      </Section>
    </>
  );
}
