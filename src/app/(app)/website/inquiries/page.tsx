import { requireUser } from "@/server/auth";
import { listInquiries } from "@/server/services/websiteInquiries";
import { InquiriesTab } from "./inquiries-client";

export const metadata = { title: "Website · Inquiries" };

export default async function WebsiteInquiriesPage() {
  await requireUser("MANAGER");
  return <InquiriesTab rows={await listInquiries(200)} />;
}
