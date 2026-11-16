import { requireUser } from "@/server/auth";
import { websiteConnection } from "@/server/services/website";
import { eventPageEditor } from "@/server/services/websiteEventPages";
import { notFound } from "next/navigation";
import { EventPageEditorView } from "./page-editor";

export const metadata = { title: "Website · Event page" };

export default async function WebsiteEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const [editor, conn] = await Promise.all([eventPageEditor(String(id).slice(0, 40)), websiteConnection()]);
  if (!editor) notFound();
  return <EventPageEditorView e={editor} siteUrl={conn.url} />;
}
