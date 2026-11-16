import type { ReactNode } from "react";
import { KegSectionTabs } from "./section-tabs";

/**
 * Every keg page. The manager sections (Analytics, Wholesale, Manage) each
 * hold several pages; this puts that section's tabs above the page. Staff only
 * reach Taps, Scan and the Walk-in, which have no tabs. Each page still checks
 * who may see it.
 */
export default function KegsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <KegSectionTabs />
      {children}
    </>
  );
}
