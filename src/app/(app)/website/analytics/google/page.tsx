import { permanentRedirect } from "next/navigation";
import { GOOGLE_HUB_HREF } from "@/domain/googleHub";
import { requireUser } from "@/server/auth";

/** The old Connect Google page: Google now lives on Settings → Connections → Google. Carries a sign-in result along. */
export default async function OldGooglePage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.error) q.set("error", sp.error);
  if (sp.connected) q.set("connected", sp.connected);
  const query = q.toString();
  permanentRedirect(query ? `${GOOGLE_HUB_HREF}?${query}` : GOOGLE_HUB_HREF);
}
