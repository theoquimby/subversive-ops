import { PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { breweryDefaults, brewerySnap, loadTanks } from "@/server/services/brewery";
import { BrewDays, DefaultDays, TankGrid } from "./setup-client";

export const metadata = { title: "Brewery setup" };

export default async function Page() {
  await requireUser("MANAGER");
  const [tanks, defaults, snap] = await Promise.all([loadTanks(), breweryDefaults(), brewerySnap()]);
  return (
    <>
      <PageHeader help="brewery.setup" title="Tanks & defaults" description="Your fermenters and brite tanks with their sizes and where they stand, how long a beer usually spends in each, and the days you transfer and package." />
      <Section title="Tanks" description="Click a cell to change it. Zone, row and column place a tank on the floor plan. Order sets which tank is tried first when planning.">
        <TankGrid tanks={tanks} />
      </Section>
      <Section title="Transfer and packaging days" description="Planned transfers and packaging move to the nearest of these days, up to three days either way.">
        <BrewDays transferDays={[...snap.transferDays]} packageDays={[...snap.packageDays]} />
      </Section>
      <Section title="Usual days in tanks" description="Used when a brew has no recipe and no timing profile. A recipe's own days always win.">
        <DefaultDays fermentDays={defaults.fermentDays} conditionDays={defaults.conditionDays} />
      </Section>
    </>
  );
}
