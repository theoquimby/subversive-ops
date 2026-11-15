import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { verifyDisplayToken } from "@/server/display-token";
import { businessTz, isCurrentNonce, publicTapList } from "@/server/services/taps";
import { TapBoardDisplay } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "On tap", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport: Viewport = { themeColor: "#0d0c0b", colorScheme: "dark" };

/**
 * The tap list on a TV: full screen, no sign-in. Middleware lets the URL
 * through only with a signed token; here we check it's the current one.
 */
export default async function TapBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const nonce = await verifyDisplayToken(token, process.env.SESSION_SECRET ?? "");
  if (!(await isCurrentNonce(nonce))) notFound();
  const data = await publicTapList();
  return <TapBoardDisplay token={token} initial={data} timeZone={businessTz()} />;
}
