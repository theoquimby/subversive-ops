import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { NY_UPSTATE_WAGES } from "@/domain/wageRules";
import { LaborRulesForm } from "@/app/(app)/labor/rules-form";
import { requireUser } from "@/server/auth";
import { getLaborRules, wageReview } from "@/server/services/labor-rules";
import { getAutoDraft } from "@/server/services/scheduling";
import { defaultLaborPct } from "@/server/services/settings";
import { LinkRow, SettingGroup, SettingRow } from "../controls";
import { WageReview } from "../wage-review";
import { AutoDraftSwitch, LaborTargetInput } from "./pay-client";

export const metadata = { title: "Pay & labor rules" };

export default async function PaySettingsPage() {
  await requireUser("MANAGER");
  const [review, rules, laborPct, autoDraft] = await Promise.all([wageReview(), getLaborRules(), defaultLaborPct(), getAutoDraft()]);

  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Pay & labor rules" description="Wages, overtime, breaks, the pay period and the schedule's checks. Pre-filled for New York — the app applies whatever is set here, so check it against current law." />

      <HelpZone id="settings.wageSchedule">
        <SettingGroup id="wage" title="Minimum wage">
          <WageReview {...review} table={NY_UPSTATE_WAGES} />
        </SettingGroup>
      </HelpZone>

      <SettingGroup id="target" title="Scheduling">
        <SettingRow label="Labor target" help="settings.pay.laborTarget" what="Labor % of sales the schedule aims for in weeks without their own budget." defaultNote="Default: none — only weekly budgets are used">
          <LaborTargetInput value={laborPct} />
        </SettingRow>
        <SettingRow label="Draft next week's schedule" help="settings.pay.autoDraft" what="Every Friday and Saturday, drafted from the forecast if there isn't one yet. Nothing is published until you check it." defaultNote="Default off">
          <AutoDraftSwitch on={autoDraft} />
        </SettingRow>
        <LinkRow href="/budgets" label="Weekly budgets" what="A labor % for a particular week always wins over the default." help="budgets.page" />
      </SettingGroup>

      <HelpZone id="settings.laborRules">
        <SettingGroup id="rules" title="Pay, shifts, sick leave and checks" description="Each value saves when you leave the box. Overtime is counted Monday to Sunday.">
          <LaborRulesForm rules={rules} />
        </SettingGroup>
      </HelpZone>

      <SettingGroup title="Tips">
        <LinkRow href="/tips" label="Tip pools" what="Split each period by hours worked or by points." help="settings.pay.tips" />
        <LinkRow href="/team" label="Tip points by position" what="Each position's points and whether it shares tips, on the Team page." />
      </SettingGroup>
    </div>
  );
}
