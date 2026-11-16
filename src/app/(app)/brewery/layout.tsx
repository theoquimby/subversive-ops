import type { ReactNode } from "react";
import { BrewerySectionTabs } from "./section-tabs";

/** Every brewery page: the section's tabs (Setup has two pages) above the page. Each page checks who may see it. */
export default function BreweryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <BrewerySectionTabs />
      {children}
    </>
  );
}
