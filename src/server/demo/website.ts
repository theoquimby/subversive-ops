import type { PrismaClient } from "@prisma/client";
import { addDays, type ISODate } from "@/domain/dates";

/**
 * Website demo: upcoming public events with web fields, menu items on the
 * website with descriptions and tags, exact hours and kitchen close times,
 * a notice, links, and one inquiry from the form. Run after the base demo
 * (and the keg + tap demos for a draft list). Clears its own rows first.
 */

const EVENTS: { offset: number; title: string; kind: string; start: string | null; end: string | null; notes: string | null; web?: Record<string, unknown> }[] = [
  { offset: 2, title: "Subversive Overtime: Knicks vs. Blazers", kind: "GAME", start: "19:30", end: "22:00", notes: "We're staying open late for Knicks basketball. Tipoff at 7:30.", web: { kitchenCloseOverride: "20:15", featured: true } },
  {
    offset: 16,
    title: "Winterfest",
    kind: "FESTIVAL",
    start: "12:00",
    end: "20:00",
    notes: "A day in the heated tent with our winter beers, a fire pit and live music.",
    web: {
      featured: true,
      priceLabel: "Free entry",
      page: {
        intro: "Our winter beers on tap all day, a fire pit in the yard and the Catskill Ramblers in the tent. Bring the dog.",
        sections: [
          { title: "Beer", body: "Every winter beer we make, plus a first pour of this year's Baltic porter at noon.\n\nFlights all day." },
          { title: "Food", body: "Smash burgers, brats with kraut and soft pretzels. The kitchen stays open until 7." },
        ],
        schedule: [
          { time: "Noon", what: "Doors, and the first pour of the Baltic porter" },
          { time: "2:00", what: "Fire pit lit, s'mores at the bar" },
          { time: "5:00", what: "The Catskill Ramblers in the tent" },
        ],
        links: [{ label: "The Catskill Ramblers", href: "https://ramblers.example.com/" }],
      },
    },
  },
  { offset: 5, title: "Trivia with Smarty Pints", kind: "OTHER", start: "18:30", end: "20:30", notes: "Biweekly trivia. The winning team takes home a 4-pack.", web: { webKind: "TRIVIA", priceLabel: "Free" } },
  { offset: 9, title: "Thanksgiving", kind: "HOLIDAY", start: null, end: null, notes: null },
  { offset: 12, title: "Live music: The Catskill Ramblers", kind: "MUSIC", start: "18:00", end: "20:30", notes: "Bluegrass in the heated tent.", web: { priceLabel: "$10 at the door", ticketUrl: "https://tickets.example.com/ramblers" } },
  { offset: 20, title: "Closed for a staff day", kind: "CLOSURE", start: null, end: null, notes: null },
];


const DESCRIPTIONS: Record<string, string> = { Burgers: "Lettuce, American cheese, house-made pickles, Subversive Sauce.", Salads: "Mixed greens, cucumber, red onion, tomato, croutons.", Wings: "24-hour house-brined jumbo wings with carrots and celery." };

export async function seedWebsite(db: PrismaClient, today: ISODate): Promise<void> {
  const titles = EVENTS.map((e) => e.title);
  const old = await db.event.findMany({ where: { title: { in: titles } }, select: { id: true } });
  await db.webEvent.deleteMany({ where: { eventId: { in: old.map((o) => o.id) } } });
  await db.event.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  for (const e of EVENTS) {
    const date = addDays(today, e.offset);
    const row = await db.event.create({ data: { date: new Date(`${date}T00:00:00Z`), title: e.title, kind: e.kind, startTime: e.start, endTime: e.end, notes: e.notes, impact: e.kind === "CLOSURE" ? 0 : 1.2 } });
    if (e.web) await db.webEvent.create({ data: { eventId: row.id, slug: `${date}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, ...e.web } });
  }

  // Menu: the first few active items of each category go on the website.
  await db.webMenuItem.deleteMany({});
  await db.webMenuSection.deleteMany({});
  const recipes = await db.recipe.findMany({ where: { kind: { in: ["MENU", "MODIFIER"] }, active: true }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true } });
  const perCat = new Map<string, number>();
  for (const r of recipes) {
    const n = perCat.get(r.category) ?? 0;
    if (n >= 3) continue;
    perCat.set(r.category, n + 1);
    const veg = /salad|fries|veg|impossible|pretzel|pickle/i.test(r.name);
    await db.webMenuItem.create({ data: { recipeId: r.id, onWebsite: true, description: DESCRIPTIONS[r.category] ?? null, tags: veg ? ["vegetarian"] : /kid/i.test(r.category) ? ["kid-friendly"] : [], badge: n === 0 && r.category === "Burgers" ? "Most loved" : null, sort: n } });
  }
  if (recipes.some((r) => r.category === "Burgers")) await db.webMenuSection.create({ data: { id: "burgers", title: "Subversive smash burgers", place: "food", intro: "Local beef, smashed thin, on a See & Be milk bun.", sort: 1 } });

  const set = (key: string, value: unknown) => db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
  await set("website.notice", { text: "Closed Thanksgiving Day. Open late for every Knicks game this month.", until: addDays(today, 10) });
  await set("website.hours", { mon: { open: "16:30" }, wed: { open: "16:30" }, thu: { open: "16:30" }, fri: { open: "16:30", close: "20:30", kitchenClose: "20:15" }, sat: { close: "20:30", kitchenClose: "20:15" }, sun: { close: "18:30", kitchenClose: "18:15" } });
  await set("website.links", { order: "https://subversiveonline.square.site/", instagram: "https://www.instagram.com/subversivebeer/", facebook: "https://www.facebook.com/subversivemaltnbrew/", map: "https://g.page/subversivebeer?share" });
  await set("website.phoneNote", "Only answered during taproom hours.");

  // Announcements: a closure for Thanksgiving week and a line pointing at Winterfest's page.
  await db.webAnnouncement.deleteMany({ where: { publicId: { startsWith: "demo-" } } });
  const winterfest = addDays(today, 16);
  await db.webAnnouncement.createMany({
    data: [
      { publicId: "demo-thanksgiving", text: "Closed Thanksgiving Day. Open Friday from noon.", tone: "closure", from: new Date(`${addDays(today, 4)}T00:00:00Z`), until: new Date(`${addDays(today, 9)}T00:00:00Z`), sort: 1 },
      { publicId: "demo-winterfest", text: "Winterfest: winter beers, a fire pit and live music in the tent.", tone: "event", linkHref: `/events/${winterfest}-winterfest`, linkLabel: "Details", until: new Date(`${winterfest}T00:00:00Z`), sort: 2 },
    ],
  });

  await db.webInquiry.deleteMany({ where: { ipHash: "demo" } });
  const pe = await db.privateEvent.create({ data: { clientName: "Jordan Alvarez", clientEmail: "jordan@example.com", type: "PARTY", date: new Date(`${addDays(today, 30)}T00:00:00Z`), headcount: 35, notes: "From the website form · Birthday.\n\nCould we have the tent for a 40th? Around 6pm." } });
  await db.webInquiry.create({ data: { privateEventId: pe.id, name: "Jordan Alvarez", email: "jordan@example.com", date: new Date(`${addDays(today, 30)}T00:00:00Z`), guests: 35, type: "Birthday", message: "Could we have the tent for a 40th? Around 6pm.", ipHash: "demo" } });
}
