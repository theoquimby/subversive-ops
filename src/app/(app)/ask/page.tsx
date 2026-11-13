import { HelpTip, HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { SUGGESTED_QUESTIONS } from "@/domain/ask";
import { requireUser } from "@/server/auth";
import { claudeConfigured } from "@/server/integrations/claude";
import { AskChat } from "./ask-client";

export const metadata = { title: "Ask" };

export default async function AskPage() {
  await requireUser("MANAGER");
  const claude = claudeConfigured();
  return (
    <>
      <PageHeader
        title={<span className="inline-flex items-center gap-2">Ask <HelpTip id="ask.page" /></span>}
        description={
          claude
            ? "Ask about sales, food cost, margins, prices, labor, the schedule, orders or waste in plain English. Answers come from your live numbers, with links to the pages behind them."
            : "Tap a question to get the answer from your live numbers. Free-form questions work best once the Claude API key is added; until then, simple ones are matched to the closest report."
        }
      />
      <HelpZone id="ask.page" tour="ask">
        <AskChat suggestions={SUGGESTED_QUESTIONS.map((s) => s.label)} claude={claude} />
      </HelpZone>
    </>
  );
}
