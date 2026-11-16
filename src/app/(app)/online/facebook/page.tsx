import { parseRange } from "@/domain/online";
import { requireUser } from "@/server/auth";
import { socialReport } from "@/server/services/online";
import { SocialPage } from "../social";

export const metadata = { title: "Facebook Page" };

export default async function FacebookPage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  await requireUser("MANAGER");
  return <SocialPage r={await socialReport("facebook", parseRange((await searchParams).range))} />;
}
