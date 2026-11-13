import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getRange } from "@/server/services/analytics";
import { reviewSettings } from "@/server/services/reviews";
import { LinkRow, SettingGroup, SettingRow } from "../controls";
import { RangeChoice, ToneNotes } from "./insights-client";

export const metadata = { title: "Insights & reviews" };

export default async function InsightsSettingsPage() {
  await requireUser("MANAGER");
  const [range, reviews] = await Promise.all([getRange(), reviewSettings()]);
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Insights & reviews" description="How much history Insights learns from, and how drafted review replies sound." />

      <SettingGroup id="range" title="Insights">
        <SettingRow label="History Insights uses" help="insights.range" what="More years teach seasons and price changes better; fewer keep old menus from misleading. Changing it works everything out again, which can take a minute." defaultNote="Default: last 3 years">
          <RangeChoice value={range} />
        </SettingRow>
        <LinkRow href="/settings/money#fixed" label="Fixed monthly costs" what="Rent, utilities and insurance, for break-even and profit." />
      </SettingGroup>

      <SettingGroup id="tone" title="Reviews">
        <SettingRow wide label="Review reply voice" help="settings.insights.tone" what="A few short notes every drafted reply follows. Leave blank for a warm, short default.">
          <ToneNotes value={reviews.toneNotes} />
        </SettingRow>
        <LinkRow href="/settings/connections?open=google" label="Google listing" what="Which Google business reviews are imported from." value={reviews.placeName || (reviews.placeId ? "Set" : "Not set")} />
      </SettingGroup>
    </div>
  );
}
