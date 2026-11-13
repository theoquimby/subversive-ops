import type { ReactNode } from "react";
import { SettingsNav } from "./settings-nav";

/**
 * Settings: on desktop a section nav on the left of every Settings page; on a
 * phone the home page is the list you drill into and each page has a back link.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-10">
      <SettingsNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
