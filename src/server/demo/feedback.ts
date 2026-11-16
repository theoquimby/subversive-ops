import type { PrismaClient } from "@prisma/client";

/**
 * Feedback demo: a handful of notes from the Feedback button in every state —
 * new, planned with a reply, done, won't do — from a manager, a brewer and
 * staff, one with a screenshot, so the inbox, "Your feedback", the Settings
 * count and the morning brief line have something to show. Clears its own
 * rows first.
 */

// A tiny real PNG standing in for a screenshot.
const SCREENSHOT = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export async function seedFeedback(db: PrismaClient, now = new Date()) {
  await db.appFeedback.deleteMany({});
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true } });
  const manager = users.find((u) => u.role === "MANAGER") ?? null;
  const staff = users.find((u) => u.role === "STAFF") ?? null;
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
  const as = (u: { id: string; name: string; role: string } | null, fallback: { name: string; role: string }) => ({ userId: u?.id ?? null, userName: u?.name ?? fallback.name, role: u?.role ?? fallback.role });

  const notes = [
    {
      ...as(null, { name: "Zane", role: "MANAGER" }),
      kind: "problem",
      body: "FV2 still says day 9 of 14 but we moved it to the brite yesterday. The transfer didn't stick?",
      path: "/brewery",
      pageTitle: "Tanks",
      device: "iPhone · Safari",
      status: "new",
      at: hoursAgo(3),
      photo: true,
    },
    {
      ...as(staff, { name: "Line", role: "STAFF" }),
      kind: "idea",
      body: "Could the count sheet remember which area I was in? I get pulled away and lose my place in the walk-in.",
      path: "/count",
      pageTitle: "Count",
      device: "Android · Chrome",
      status: "new",
      at: hoursAgo(20),
    },
    {
      ...as(null, { name: "Max", role: "MANAGER" }),
      kind: "question",
      body: "Where do I change the delivery day for the bakery? I looked under Ordering first.",
      path: "/ordering",
      pageTitle: "Ordering",
      device: "Mac · Chrome",
      status: "new",
      at: hoursAgo(26),
    },
    {
      ...as(manager, { name: "Max", role: "MANAGER" }),
      kind: "idea",
      body: "Show the beer's ABV on the tap list TV under the name.",
      path: "/kegs/taps",
      pageTitle: "Tap list & TV",
      device: "iPad · Safari",
      status: "planned",
      note: "Good one — adding it with the next tap list change.",
      at: hoursAgo(50),
    },
    {
      ...as(staff, { name: "Line", role: "STAFF" }),
      kind: "problem",
      body: "Prep list showed aioli twice this morning.",
      path: "/prep",
      pageTitle: "Prep list",
      device: "iPhone · app",
      status: "done",
      note: "Fixed — it was listed once for the burger and once for fries. Thanks!",
      at: hoursAgo(98),
    },
    {
      ...as(staff, { name: "Line", role: "STAFF" }),
      kind: "praise",
      body: "Scanning kegs is so much faster than the old app.",
      path: "/kegs/scan",
      pageTitle: "Scan a keg",
      device: "iPhone · Safari",
      status: "done",
      at: hoursAgo(140),
    },
    {
      ...as(null, { name: "Zane", role: "MANAGER" }),
      kind: "idea",
      body: "Could we track hop prices by lot number?",
      path: "/brewery/recipes",
      pageTitle: "Recipes",
      device: "Windows · Edge",
      status: "wont",
      note: "Not for now — prices per hop are enough for costing. Let's revisit if a supplier starts pricing by lot.",
      at: hoursAgo(190),
    },
  ];

  for (const n of notes) {
    await db.appFeedback.create({
      data: {
        userId: n.userId,
        userName: n.userName,
        role: n.role,
        kind: n.kind,
        body: n.body,
        path: n.path,
        pageTitle: n.pageTitle,
        device: n.device,
        appVersion: "1.21",
        status: n.status,
        note: "note" in n ? n.note : null,
        createdAt: n.at,
        photoMime: "photo" in n ? "image/png" : null,
        photo: "photo" in n ? Buffer.from(SCREENSHOT, "base64") : null,
      },
    });
  }
}
