import type { Prisma, PrismaClient } from "@prisma/client";
import { addDays, parseISODate, todayIn, weekday, type ISODate } from "../../domain/dates";

/**
 * Online channels demo: about 120 days of Instagram and Facebook Page daily
 * numbers and about 30 of the business's own posts, so Online → Instagram,
 * Online → Facebook and the Social rows of Online → Overview can be judged
 * before Meta is connected.
 *
 * Shaped like a taproom: busy Fridays and Saturdays; Instagram growing
 * slowly, with one reel that travelled far about ten days ago; the Facebook
 * Page steady but seen less over the last four weeks; a post from yesterday
 * whose numbers haven't arrived. Deterministic.
 *
 * Adds only: rows that already exist are left alone, nothing is deleted, and
 * no other table (and no connection setting) is touched, so it is safe to run
 * on its own against a database that already has data:
 *
 *   npx tsx -e "import('./src/server/demo/onlineChannels').then(async (m) => { const { PrismaClient } = await import('@prisma/client'); const db = new PrismaClient(); console.log(await m.seedOnlineChannels(db)); await db.$disconnect(); })"
 *
 * `replace: true` clears the Instagram and Facebook rows of the two tables
 * first (a clean re-run). Meta runs a day or two behind, so the daily numbers
 * stop two days ago; the follower counts run to today.
 */

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const DAYS = 120;
const LAG = 2;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A count around `lambda` (a normal approximation is plenty for daily counts). */
const around = (r: () => number, lambda: number) => {
  if (lambda <= 0) return 0;
  const z = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
};

/** [days ago, kind, caption, reach as a multiple of a usual post] */
const IG_POSTS: [number, string, string, number][] = [
  [1, "post", "Kitchen special this weekend: smash burger with beer cheese. Until it's gone.", 0],
  [4, "reel", "Pouring the first pints of the winter stout", 1.5],
  [7, "carousel", "Saturday in the taproom", 0.9],
  [10, "reel", "Trivia night is back this Thursday. Teams of up to six, starts at 7.", 5.6],
  [13, "post", "New on tap: a dry-hopped pilsner, crisp and a little floral", 1.1],
  [17, "post", "We're closed Monday for a deep clean. Back Tuesday at 4.", 0.4],
  [20, "reel", "Brew day, start to finish, in thirty seconds", 1.8],
  [24, "carousel", "Faces from the harvest party", 1.2],
  [28, "post", "Flights are back: four pours, your pick", 0.9],
  [32, "reel", "How a keg gets cleaned", 1.3],
  [36, "post", "Live music Friday: doors at 6, no cover", 1.0],
  [41, "post", "The patio heaters are on", 0.7],
  [45, "carousel", "New merch: beanies and a heavier hoodie", 0.8],
  [50, "reel", "Canning day", 1.6],
  [55, "post", "Thank you for a huge Oktoberfest weekend", 1.4],
  [61, "post", "Oktoberfest this Saturday: steins, pretzels, a brass band", 1.7],
  [66, "reel", "Pretzel test batch number three", 1.2],
  [72, "post", "Dogs are welcome on the patio, as ever", 1.0],
  [79, "carousel", "The fresh-hop ale is on", 1.1],
  [86, "post", "Hiring: weekend line cook. Ask at the bar.", 0.6],
  [95, "reel", "Hop harvest at the farm up the road", 1.5],
  [108, "post", "Late summer hours start this week", 0.5],
];

const FB_POSTS: [number, string, string, number][] = [
  [3, "post", "Kitchen special this weekend: smash burger with beer cheese.", 0.9],
  [10, "video", "Trivia night is back this Thursday. Teams of up to six, starts at 7.", 2.4],
  [17, "text", "We're closed Monday for a deep clean. Back Tuesday at 4.", 1.3],
  [24, "post", "Faces from the harvest party", 1.0],
  [36, "post", "Live music Friday: doors at 6, no cover", 1.1],
  [50, "link", "We made the county paper's list of places to take visitors", 1.6],
  [61, "post", "Oktoberfest this Saturday: steins, pretzels, a brass band", 1.8],
  [79, "post", "The fresh-hop ale is on", 0.8],
  [95, "video", "Hop harvest at the farm up the road", 1.2],
  [110, "text", "Late summer hours start this week", 0.7],
];

type Daily = Prisma.OnlineChannelDailyCreateManyInput;
type Post = Prisma.OnlinePostCreateManyInput;

export async function seedOnlineChannels(db: PrismaClient, today: ISODate = todayIn(TZ), opts: { replace?: boolean } = {}): Promise<{ daily: number; posts: number; from: ISODate; to: ISODate }> {
  const r = rng(20261116);
  const from = addDays(today, -DAYS);
  const to = addDays(today, -LAG);
  if (opts.replace) await db.$transaction([db.onlineChannelDaily.deleteMany({ where: { channel: { in: ["instagram", "facebook"] } } }), db.onlinePost.deleteMany({ where: { channel: { in: ["instagram", "facebook"] } } })]);

  const daily: Daily[] = [];
  const put = (channel: string, d: ISODate, values: Record<string, number>) => {
    for (const [metric, value] of Object.entries(values)) daily.push({ channel, day: parseISODate(d), metric, value });
  };
  // How much each post lifts the days after it went up (most on the day, fading over four).
  const lift = (posts: [number, string, string, number][], age: number) => posts.reduce((s, [ago, , , x]) => (ago >= age && ago - age < 4 ? s + x * [1, 0.5, 0.25, 0.1][ago - age] : s), 0);

  let igFollowers = 2010;
  let fbFollowers = 1790;
  for (let d = from, i = 0; d <= today; d = addDays(d, 1), i++) {
    const age = DAYS - i; // days before today
    const busy = [1.05, 0.85, 0.75, 0.9, 1.0, 1.35, 1.45][weekday(d)];
    const grow = 1 + (0.25 * i) / DAYS;

    // Followers are a count on a day, so they run to today.
    const igFollows = around(r, 2.4 * grow + lift(IG_POSTS, age) * 2.2);
    const igUnfollows = around(r, 1.1);
    igFollowers += igFollows - igUnfollows;
    const fbFollows = around(r, 0.5);
    const fbUnfollows = around(r, 0.45);
    fbFollowers += fbFollows - fbUnfollows;
    put("instagram", d, { followers: igFollowers });
    put("facebook", d, { followers: fbFollowers });
    if (d > to) continue;

    const igReach = around(r, (260 * busy + 310 * lift(IG_POSTS, age)) * grow);
    const likes = around(r, igReach * 0.055);
    const comments = around(r, igReach * 0.006);
    const saves = around(r, igReach * 0.007);
    const shares = around(r, igReach * 0.009);
    const call = around(r, 0.9 * busy);
    const directions = around(r, 1.6 * busy);
    const email = around(r, 0.12);
    const text = around(r, 0.08);
    put("instagram", d, {
      reach: igReach,
      views: Math.round(igReach * (2.2 + r() * 0.5)),
      engaged: Math.round((likes + comments + saves + shares) * 0.8),
      interactions: likes + comments + saves + shares,
      likes,
      comments,
      saves,
      shares,
      profile_taps: call + directions + email + text,
      tap_call: call,
      tap_directions: directions,
      tap_email: email,
      tap_text: text,
      follows: igFollows,
      unfollows: igUnfollows,
    });

    // The Page has been seen less over the last four weeks.
    const fade = age <= 28 ? 0.62 : 1;
    const fbReach = around(r, (150 * busy + 120 * lift(FB_POSTS, age)) * fade);
    put("facebook", d, {
      reach: fbReach,
      views: Math.round(fbReach * (1.7 + r() * 0.4)),
      profile_visits: around(r, 13 * busy * fade),
      follows: fbFollows,
      unfollows: fbUnfollows,
      interactions: around(r, fbReach * 0.05),
      profile_taps: around(r, 1.4 * busy),
    });
  }

  const posts: Post[] = [];
  const at = (ago: number, hour: number) => new Date(parseISODate(addDays(today, -ago)).getTime() + hour * 3600_000);
  IG_POSTS.forEach(([ago, kind, caption, x], n) => {
    const base = { channel: "instagram", externalId: `demo-ig-${n + 1}`, postedAt: at(ago, 21), kind, caption };
    // Yesterday's post: Instagram hasn't reported on it yet.
    if (x === 0) return void posts.push(base);
    const reach = around(r, 620 * x * (kind === "reel" ? 1.15 : 1));
    const likes = around(r, reach * 0.07);
    const comments = around(r, reach * 0.008);
    const saves = around(r, reach * 0.01);
    const shares = around(r, reach * (kind === "reel" ? 0.03 : 0.012));
    posts.push({
      ...base,
      reach,
      views: Math.round(reach * (kind === "reel" ? 1.9 : 1.4)),
      likes,
      comments,
      saves,
      shares,
      interactions: likes + comments + saves + shares,
      // A reel reports watch time instead of the profile visits it led to.
      ...(kind === "reel" ? { extra: { avgWatchSeconds: Math.round((5 + r() * 6) * 10) / 10 } } : { profileVisits: around(r, reach * 0.03), follows: around(r, reach * 0.004) }),
      metricsAt: new Date(),
    });
  });
  FB_POSTS.forEach(([ago, kind, caption, x], n) => {
    const reach = around(r, 340 * x);
    const likes = around(r, reach * 0.045);
    const comments = around(r, reach * 0.008);
    const shares = around(r, reach * 0.01);
    posts.push({ channel: "facebook", externalId: `demo-fb-${n + 1}`, postedAt: at(ago, 20), kind, caption, reach, views: Math.round(reach * 1.5), likes, comments, shares, interactions: likes + comments + shares, extra: { clicks: around(r, reach * 0.04) }, metricsAt: new Date() });
  });

  const [dd, pp] = await Promise.all([db.onlineChannelDaily.createMany({ data: daily, skipDuplicates: true }), db.onlinePost.createMany({ data: posts, skipDuplicates: true })]);
  return { daily: dd.count, posts: pp.count, from, to };
}
