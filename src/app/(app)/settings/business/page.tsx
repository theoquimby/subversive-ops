import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { location } from "@/server/services/forecasting";
import { getRegularHours, getSeasonalHours } from "@/server/services/labor-rules";
import { getBusinessContact } from "@/server/services/settings";
import { pendingSuggestions } from "@/server/services/learned";
import { HoursSuggestionCard, WeatherSuggestionCard } from "../learned-cards";
import { SettingGroup, SettingRow } from "../controls";
import { ContactField, HoursEditor, SeasonsEditor, WeatherLocationEditor } from "./business-client";

export const metadata = { title: "Business profile" };

export default async function BusinessSettingsPage() {
  await requireUser("MANAGER");
  const [contact, regular, seasons, loc, learned] = await Promise.all([getBusinessContact(), getRegularHours(), getSeasonalHours(), location(), pendingSuggestions()]);
  const inGroup = "rounded-none rounded-t-xl border-0 bg-surface-2/40";
  const zone = env.BUSINESS_TIMEZONE;
  const now = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", weekday: "short" }).format(new Date());

  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Business profile" description="Who you are, when you're open and where. The forecast, the schedule and supplier emails use these." />

      <SettingGroup id="profile" title="Name & contact" description="Shown at the bottom of every order you email to a supplier.">
        <SettingRow label="Business name" help="settings.business.profile"><ContactField field="name" value={contact.name} label="Business name" autoComplete="organization" /></SettingRow>
        <SettingRow label="Delivery address" what="Where suppliers deliver."><ContactField field="address" value={contact.address} label="Delivery address" placeholder="Street, Catskill, NY 12414" autoComplete="street-address" /></SettingRow>
        <SettingRow label="Phone" what="For drivers and suppliers."><ContactField field="phone" type="tel" value={contact.phone} label="Phone" placeholder="(518) 555-0100" autoComplete="tel" /></SettingRow>
        <SettingRow label="Email"><ContactField field="email" type="email" value={contact.email} label="Business email" placeholder="hello@yourbrewery.com" autoComplete="email" /></SettingRow>
        <SettingRow label="Website"><ContactField field="website" type="url" value={contact.website} label="Website" placeholder="yourbrewery.com" autoComplete="url" /></SettingRow>
      </SettingGroup>

      <HelpZone id="settings.business.hours">
        <SettingGroup id="hours" title="Opening hours" description="The hours you serve. The hourly forecast, staffing and Insights use them; closed days are treated as closed every week.">
          {learned.hours?.target.kind === "regular" && <HoursSuggestionCard s={learned.hours} className={inGroup} />}
          <HoursEditor initial={regular} />
        </SettingGroup>
      </HelpZone>

      <HelpZone id="settings.business.seasons">
        <SettingGroup id="seasons" title="Seasonal hours" description="Optional. Different hours for part of the year, every year. One-off closures and holidays go on Events.">
          {learned.hours?.target.kind === "season" && <HoursSuggestionCard s={learned.hours} className={inGroup} />}
          <SeasonsEditor key={JSON.stringify(seasons)} initial={seasons} regular={regular} />
        </SettingGroup>
      </HelpZone>

      <HelpZone id="settings.business.weather">
        <SettingGroup id="weather" title="Weather location" description="Where the sales forecast reads the weather from. Default Catskill, NY.">
          {learned.weather && <WeatherSuggestionCard s={learned.weather} className={inGroup} />}
          <WeatherLocationEditor initial={loc} />
        </SettingGroup>
      </HelpZone>

      <SettingGroup id="timezone" title="Time zone">
        <SettingRow label={zone.replace(/_/g, " ")} help="settings.business.timezone" what={`What "today" means for sales, counts and timecards. It's ${now} there now.`}>
          <span className="text-sm text-muted">Set when the app was installed</span>
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
