import { parseRange } from "@/domain/online";
import { requireUser } from "@/server/auth";
import { socialReport } from "@/server/services/online";
import { SocialPage } from "../social";

export const metadata = { title: "Instagram" };

export default async function InstagramPage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  await requireUser("MANAGER");
  return <SocialPage r={await socialReport("instagram", parseRange((await searchParams).range))} />;
}
