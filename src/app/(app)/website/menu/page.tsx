import { requireUser } from "@/server/auth";
import { menuFeed, menuInputs } from "@/server/services/website";
import { MenuTab } from "./menu-client";

export const metadata = { title: "Website · Menu" };

export default async function WebsiteMenuPage() {
  await requireUser("MANAGER");
  const [inputs, built] = await Promise.all([menuInputs(), menuFeed()]);
  return (
    <MenuTab
      recipes={inputs.recipes}
      sections={inputs.sections}
      taps={inputs.tapRows.map((t) => ({ line: t.line, beerId: t.beerId, beer: t.beer, style: t.style, abv: t.abv, color: t.color, house: t.house, pours: t.pours }))}
      tapWeb={inputs.taps.map((t) => ({ beerId: t.beerId, web: t.web }))}
      notices={inputs.notices}
      menu={built.menu}
      warnings={built.warnings}
    />
  );
}
