/**
 * Reviews & budgets demo: ~25 reviews over the last three months (mostly
 * happy, a few about slow service on busy Saturdays) and weekly targets for
 * the last 6 and next 4 weeks. Safe to re-run: reviews upsert on their demo
 * ids and budgets upsert by week.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { weekStartOf } from "../../domain/budgets";
import { addDays, parseISODate, todayIn, weekday, zonedMidnightUTC } from "../../domain/dates";
import { fallbackReply, keywordSentiment, keywordThemes } from "../../domain/reviews";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";

type Demo = { source: "GOOGLE" | "YELP" | "TRIPADVISOR"; author: string; rating: number; text: string; when: { daysAgo: number } | { saturdayWeeksAgo: number }; hour?: number };

const REVIEWS: Demo[] = [
  { source: "GOOGLE", author: "Dana Kowalski", rating: 5, when: { daysAgo: 88 }, text: "Stopped in after a hike at Kaaterskill Falls and this was exactly what we needed. The hazy IPA was bright and juicy, and the smash burger is legit. Sat out on the patio by the creek for two hours." },
  { source: "GOOGLE", author: "Marcus Bell", rating: 5, when: { daysAgo: 84 }, text: "Best brewery in Greene County, not even close. Friendly bartenders who actually know the beer and will happily pour you a taste before you commit." },
  { source: "YELP", author: "Priya S.", rating: 4, when: { daysAgo: 80 }, text: "Great flight, loved the pilsner and the sour. Pretzel was huge. Only knock is it's a little pricey for the snacks, but the beer is worth it." },
  { source: "GOOGLE", author: "Tom Reilly", rating: 5, when: { daysAgo: 76 }, text: "Brought our two kids and the dog. Staff brought a water bowl without us asking and the kids loved the grilled cheese. Very family friendly." },
  { source: "TRIPADVISOR", author: "WanderingHudson", rating: 5, when: { daysAgo: 71 }, text: "A real gem in Catskill. Cozy taproom, great music on a Thursday, and the wings were excellent. Will be back next time we're up from the city." },
  { source: "GOOGLE", author: "Jill Hartman", rating: 2, when: { saturdayWeeksAgo: 10 }, hour: 19, text: "Beer was good but we waited 50 minutes for two burgers on Saturday night. The place was packed and there were clearly not enough people working. Our server was apologetic but overwhelmed." },
  { source: "GOOGLE", author: "Kevin Osei", rating: 5, when: { daysAgo: 64 }, text: "Love this place. The stout is fantastic and the fries are perfectly crispy. Staff are always welcoming." },
  { source: "YELP", author: "Rachel M.", rating: 4, when: { daysAgo: 60 }, text: "Solid local spot. Beer garden is lovely in the evening. Tacos were tasty, portions a bit small for the price." },
  { source: "GOOGLE", author: "Luis Ortega", rating: 5, when: { daysAgo: 56 }, text: "Our go-to after work. Dog friendly, good vibe, great rotating taps. Ask for the crowler of whatever is fresh." },
  { source: "GOOGLE", author: "Hannah Lee", rating: 3, when: { saturdayWeeksAgo: 7 }, hour: 18, text: "Mixed visit. The beer is great and the patio view is gorgeous, but it took forever to get seated and then another 40 minutes for food. Seemed short staffed for a busy Saturday." },
  { source: "TRIPADVISOR", author: "Sam_and_Jo", rating: 5, when: { daysAgo: 47 }, text: "Wonderful afternoon. Knowledgeable bartender walked us through a flight and recommended the smash burger, which was delicious. Clean, bright space." },
  { source: "GOOGLE", author: "Brian Fitzgerald", rating: 4, when: { daysAgo: 44 }, text: "Great beer, friendly staff. Bathrooms could use a little more attention on busy nights." },
  { source: "GOOGLE", author: "Erin Walsh", rating: 1, when: { saturdayWeeksAgo: 5 }, hour: 19, text: "Waited over an hour for food on a Saturday during leaf season. Nobody checked on us, our order was forgotten and the fries came out cold. Really disappointed because we loved it last time." },
  { source: "YELP", author: "Chris P.", rating: 5, when: { daysAgo: 33 }, text: "Fantastic lager, the kind you want three of. Kitchen does simple food really well. Kid friendly and nobody minds a little noise." },
  { source: "GOOGLE", author: "Nadia Haddad", rating: 5, when: { daysAgo: 30 }, text: "We had a birthday here and the team was amazing. Great beer, great people, highly recommend." },
  { source: "GOOGLE", author: "Pete Romano", rating: 2, when: { saturdayWeeksAgo: 4 }, hour: 18, text: "Too busy, not enough staff. Stood at the bar 15 minutes before anyone took our order and the tables were sticky. Beer is still good." },
  { source: "GOOGLE", author: "Olivia Grant", rating: 5, when: { daysAgo: 24 }, text: "The pumpkin ale is so good. Cozy spot on a rainy afternoon, friendly bartenders, and the pretzel with beer cheese is a must." },
  { source: "TRIPADVISOR", author: "CatskillLocal", rating: 4, when: { daysAgo: 21 }, text: "Reliable neighborhood brewery. Food has gotten better. Wish they had a few more seats inside on weekends." },
  { source: "GOOGLE", author: "Derek Chu", rating: 5, when: { daysAgo: 18 }, text: "Delicious wings and a killer IPA. Fast service on a Wednesday night. Staff are friendly and the place is spotless." },
  { source: "YELP", author: "Megan T.", rating: 3, when: { daysAgo: 15 }, text: "Beer is great. Burger was overcooked and a bit greasy this time, and $19 felt steep for it. Hoping it was an off night." },
  { source: "GOOGLE", author: "Andre Williams", rating: 5, when: { daysAgo: 12 }, text: "Best pint in town and the crew makes you feel like a regular on your first visit. Dog loved it too." },
  { source: "GOOGLE", author: "Sofia Marino", rating: 2, when: { saturdayWeeksAgo: 1 }, hour: 19, text: "Saturday night was chaos. 45 minute wait for a table, then food took forever. One server for the whole room. Beer was good but we won't come on a weekend again." },
  { source: "GOOGLE", author: "Greg Hollis", rating: 5, when: { daysAgo: 5 }, text: "Love the new stout. Friendly, relaxed, and great with kids. Our favorite stop on the way home from the mountains." },
  { source: "TRIPADVISOR", author: "HudsonValleyEats", rating: 4, when: { daysAgo: 3 }, text: "Solid beer list and a tasty menu. Service was quick at lunch. A little pricey but worth it for the quality." },
  { source: "GOOGLE", author: "Jen Alvarez", rating: 5, when: { daysAgo: 1 }, text: "Such a warm, welcoming taproom. The pilsner is crisp and the fried chicken sandwich is amazing. Can't wait to come back." },
];

/** Saturday `n` weeks back from the most recent Saturday before today. */
function saturday(today: string, n: number) {
  let d = addDays(today, -1);
  while (weekday(d) !== 6) d = addDays(d, -1);
  return addDays(d, -7 * n);
}

export async function seedReviews(db: PrismaClient): Promise<void> {
  const today = todayIn(TZ);

  for (const [i, r] of REVIEWS.entries()) {
    const date = "daysAgo" in r.when ? addDays(today, -r.when.daysAgo) : saturday(today, r.when.saturdayWeeksAgo);
    const postedAt = new Date(zonedMidnightUTC(date, TZ).getTime() + ((r.hour ?? 14) + 2) * 3600_000);
    const themes = keywordThemes(r.text);
    const sentiment = keywordSentiment(r.rating, r.text);
    const replyDraft = fallbackReply({ author: r.author, rating: r.rating, themes, sentiment });
    // Older happy reviews have been answered; recent ones and most complaints are waiting.
    const age = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
    const replied = (sentiment === "positive" && age > 20) || (r.rating <= 2 && age > 50);
    const data = { author: r.author, rating: r.rating, text: r.text, postedAt, themes, sentiment, replyDraft, replied };
    await db.review.upsert({
      where: { source_externalId: { source: r.source, externalId: `demo-${i + 1}` } },
      create: { source: r.source, externalId: `demo-${i + 1}`, ...data },
      update: data,
    });
  }

  // Budgets: last 6 weeks + this week + next 4, from recent average sales.
  const since = addDays(today, -56);
  const agg = await db.dailySale.aggregate({ _sum: { netSales: true }, where: { date: { gte: parseISODate(since), lt: parseISODate(today) } } });
  const avgWeek = (agg._sum.netSales?.toNumber() ?? 0) / 8 || 18000;
  const thisWeek = weekStartOf(today);
  for (let i = -6; i <= 4; i++) {
    const w = addDays(thisWeek, 7 * i);
    // Gentle seasonal taper into November, rounded to the nearest $250.
    const sales = Math.round((avgWeek * (1.06 - i * 0.012)) / 250) * 250;
    const data = { sales: new Prisma.Decimal(sales), foodCostPct: new Prisma.Decimal(i < 0 ? "0.2900" : "0.2800"), laborPct: new Prisma.Decimal("0.3000") };
    await db.budget.upsert({ where: { weekStart: parseISODate(w) }, create: { weekStart: parseISODate(w), ...data }, update: data });
  }
}
