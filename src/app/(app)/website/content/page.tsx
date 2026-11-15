import { requireUser } from "@/server/auth";
import { ContentTab } from "./content-tab";

export const metadata = { title: "Website · Site content" };

export default async function WebsiteContentPage() {
  await requireUser("MANAGER");
  return <ContentTab />;
}
