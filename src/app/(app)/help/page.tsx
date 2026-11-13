import { requireUser } from "@/server/auth";
import { HelpCenter } from "./help-center";

export const metadata = { title: "Help" };

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string; tour?: string }> }) {
  const me = await requireUser();
  const { q = "", tour } = await searchParams;
  return <HelpCenter userId={me.userId} role={me.role} initialQuery={q} autoTour={tour} />;
}
