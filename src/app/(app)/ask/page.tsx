import { HelpTip } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { SUGGESTED_QUESTIONS } from "@/domain/ask";
import { requireUser } from "@/server/auth";
import { claudeReady } from "@/server/integrations/claude";
import { AskChat } from "./ask-client";

export const metadata = { title: "Ask" };

export default async function AskPage() {
  await requireUser("MANAGER");
  const claude = await claudeReady();
  return (
    <>
      <PageHeader
        help="ask.page"
        title={<span className="inline-flex items-center gap-2">Ask <HelpTip id="ask.page" /></span>}
        description={
          claude
            ? "Ask about sales, food cost, margins, prices, labor, the schedule, orders or waste in plain English. Answers come from your live numbers, with links to the pages behind them."
            : "Tap a question to get the answer from your live numbers. Free-form questions work once AI features are turned on in Settings → Connections; until then, simple ones are matched to the closest report."
        }
      />
      <div data-tour="ask">
        <AskChat suggestions={SUGGESTED_QUESTIONS.map((s) => s.label)} claude={claude} />
      </div>
    </>
  );
}
