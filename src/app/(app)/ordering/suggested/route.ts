import { getSession } from "@/server/auth";
import { suggestedOrders } from "@/server/services/orderingBoard";
import { db } from "@/server/db";
import { NextResponse } from "next/server";

/**
 * GET /ordering/suggested?ids=a,b — the suggested order for each supplier's next
 * delivery. Read-only and loaded after the page shows (it runs the forecast), so
 * it's a route rather than a server action: actions run one at a time and would
 * hold up inline edits while it works.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "MANAGER") return NextResponse.json({ error: "Sign in as a manager." }, { status: 401 });
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((x) => x.trim()).filter((x) => /^[a-z0-9]{1,40}$/i.test(x)).slice(0, 200);
  const list = ids.length ? ids : (await db.supplier.findMany({ where: { active: true }, select: { id: true } })).map((x) => x.id);
  try {
    return NextResponse.json({ suggestions: await suggestedOrders(list) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("suggested orders failed", e);
    return NextResponse.json({ error: "Couldn't work out suggested orders right now." }, { status: 500 });
  }
}
