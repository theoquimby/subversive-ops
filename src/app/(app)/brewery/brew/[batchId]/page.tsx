import { LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { brewDayData } from "@/server/services/brewDay";
import { Printer } from "lucide-react";
import { notFound } from "next/navigation";
import { AbvCalculator, GravityUnitToggle } from "../gravity-bits";
import { BrewDay } from "./brew-day";

export const metadata = { title: "Brew day" };

export default async function BrewDayPage({ params }: { params: Promise<{ batchId: string }> }) {
  await requireUser("MANAGER");
  const { batchId } = await params;
  const data = await brewDayData(batchId);
  if (!data) notFound();
  const b = data.batch;
  const size = b.bbl ?? data.recipe?.batchBbl ?? null;
  return (
    <>
      <PageHeader
        help="brewery.brewday"
        title={b.name}
        back={{ href: "/brewery/brew", label: "Brew days" }}
        description={[b.code, data.recipe && data.recipe.name !== b.name ? data.recipe.name : null, size != null ? `${Number(size.toFixed(2))} bbl` : null, data.recipe?.style].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GravityUnitToggle unit={data.unit} />
            <AbvCalculator unit={data.unit} og={b.og ?? data.finish.og ?? data.recipe?.targetOg} fg={b.fg ?? data.recipe?.targetFg} />
            <LinkButton href={`/print/brew/${b.id}`} target="_blank" className="h-10 sm:h-9"><Printer className="size-4" />Brew sheet</LinkButton>
          </div>
        }
      />
      <BrewDay data={data} />
    </>
  );
}
