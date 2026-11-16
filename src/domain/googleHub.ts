/**
 * Settings → Connections → Google: every Google connection on one page.
 *
 * Google needs two things from the owner: one Google sign-in (OAuth), which
 * covers Search Console, the Google listing (Business Profile) and, later,
 * Google Analytics; and one key (Places API), which brings in Google reviews.
 * This works out each piece's state from what the app knows, the one next
 * step for that state, and the summary line at the top. Pure: no I/O.
 */

export const GOOGLE_HUB_HREF = "/settings/connections/google";

export type HubPieceId = "signin" | "search" | "listing" | "analytics" | "reviews";

/** working · waiting on Google · needs fixing · not set up · waiting on the sign-in · not built yet. */
export type HubStatus = "working" | "waiting" | "fix" | "off" | "blocked" | "coming";

export type HubTone = "good" | "warn" | "bad" | "neutral";

export interface GoogleHubFacts {
  signIn: {
    clientIdSaved: boolean;
    clientSecretSaved: boolean;
    /** Signed in and not needing a reconnect. */
    connected: boolean;
    connectedBy: string | null;
    connectedAt: string | null;
    /** Why Google ended the sign-in, in plain words; null while it's fine. */
    needsReconnect: string | null;
    /** Search Console was ticked at sign-in. */
    searchAllowed: boolean;
    /** Business Profile was ticked at sign-in. */
    listingAllowed: boolean;
  };
  search: { siteUrl: string | null; syncedAt: string | null; error: string | null; hasData: boolean };
  listing: { location: string | null; title: string | null; syncedAt: string | null; error: string | null; hasData: boolean };
  /** fromListing: the business is the picked Business Profile listing (by its place id), not a separate search. */
  reviews: { keySaved: boolean; placeId: string | null; placeName: string | null; fromListing?: boolean; test: { ok: boolean; message: string; at: string } | null };
}

export interface HubPiece {
  id: HubPieceId;
  title: string;
  status: HubStatus;
  /** Badge text. */
  label: string;
  tone: HubTone;
  /** The page its numbers show on. */
  feeds: { label: string; href: string } | null;
  /** Shown indented under the sign-in, which it needs. */
  underSignIn: boolean;
  /** Where it stands, in a sentence or two (or Google's error in plain words). */
  line: string;
  /** When it last read from Google, if it has. */
  syncedAt: string | null;
  /** The single next step, or null when there's nothing to do. */
  next: string | null;
  /** Whether "How to set this up" starts open. */
  setupOpen: boolean;
}

export interface GoogleHub {
  pieces: HubPiece[];
  counts: Record<HubStatus, number>;
  /** "3 working · 1 waiting on Google · 1 coming next". */
  summary: string;
}

const LOOK: Record<HubStatus, { label: string; tone: HubTone; count: string }> = {
  working: { label: "Working", tone: "good", count: "working" },
  fix: { label: "Needs fixing", tone: "bad", count: "needs fixing" },
  waiting: { label: "Waiting on Google", tone: "neutral", count: "waiting on Google" },
  blocked: { label: "Waiting on sign-in", tone: "neutral", count: "waiting on the sign-in" },
  off: { label: "Not set up", tone: "neutral", count: "not set up" },
  coming: { label: "Coming next", tone: "neutral", count: "coming next" },
};

/** Summary order: what works, then what needs you, then what's waiting, then what's still to come. */
const ORDER: HubStatus[] = ["working", "fix", "waiting", "blocked", "off", "coming"];

/** Google's zero-quota answer for a project whose Business Profile access isn't approved yet (see friendlyGoogleError). */
export const isApprovalWait = (error: string | null | undefined): boolean => !!error && /hasn't approved Business Profile API access|quota is 0/i.test(error);

const FEEDS: Record<HubPieceId, HubPiece["feeds"]> = {
  signin: null,
  search: { label: "Online › Overview", href: "/online" },
  listing: { label: "Online › Google listing", href: "/online/google" },
  analytics: { label: "Online › Website", href: "/website/analytics" },
  reviews: { label: "Reviews", href: "/reviews" },
};

const TITLES: Record<HubPieceId, string> = {
  signin: "Your Google sign-in",
  search: "Search Console",
  listing: "Google listing",
  analytics: "Google Analytics",
  reviews: "Google reviews key",
};

type Draft = Pick<HubPiece, "status" | "line" | "next"> & { syncedAt?: string | null; setupOpen?: boolean };

const make = (id: HubPieceId, d: Draft): HubPiece => ({
  id,
  title: TITLES[id],
  status: d.status,
  label: LOOK[d.status].label,
  tone: LOOK[d.status].tone,
  feeds: FEEDS[id],
  underSignIn: id === "search" || id === "listing" || id === "analytics",
  line: d.line,
  syncedAt: d.syncedAt ?? null,
  next: d.next,
  setupOpen: d.setupOpen ?? d.status === "off",
});

const FIRST_SIGN_IN = "Do the Google sign-in above first.";
const WAITING_ON_SIGN_IN = "Waiting on your Google sign-in. Once it's connected again, this picks up where it left off.";
const AFTER_FIX = "Once that's sorted, press Sync now under the sign-in.";

function signIn(f: GoogleHubFacts["signIn"]): Draft {
  const both = f.clientIdSaved && f.clientSecretSaved;
  if (f.needsReconnect) return { status: "fix", line: f.needsReconnect, next: both ? "Press Connect again." : "Paste the Client ID and secret again, then press Connect again.", setupOpen: !both };
  if (f.connected) return { status: "working", line: f.connectedBy ? `Connected by ${f.connectedBy}.` : "Connected.", next: null };
  if (both) return { status: "off", line: "The Client ID and secret are saved.", next: "Press Connect Google, signed in to the Google account that owns the listing." };
  if (f.clientIdSaved || f.clientSecretSaved) return { status: "off", line: "Half done.", next: `Paste the Client ${f.clientIdSaved ? "secret" : "ID"} too.` };
  return { status: "off", line: "Not set up.", next: "Make a sign-in for the app in Google Cloud, then paste its Client ID and secret below. About 15 minutes, once." };
}

function search(f: GoogleHubFacts): Draft {
  const s = f.search;
  if (f.signIn.needsReconnect) return { status: "blocked", line: WAITING_ON_SIGN_IN, next: null, syncedAt: s.syncedAt, setupOpen: false };
  if (!f.signIn.connected) return { status: "off", line: "Not set up.", next: FIRST_SIGN_IN };
  if (!f.signIn.searchAllowed) return { status: "off", line: "Search Console wasn't ticked at sign-in.", next: "Press Connect again and tick Search Console." };
  if (!s.siteUrl) return { status: "off", line: "Signed in, but no website property is picked yet.", next: "Pick the website's property below, or press Find again." };
  if (s.error) return { status: "fix", line: s.error, next: AFTER_FIX, syncedAt: s.syncedAt };
  if (!s.hasData && !s.syncedAt) return { status: "working", line: `${s.siteUrl} is picked. The first numbers arrive after tonight's sync.`, next: null };
  return { status: "working", line: `Reading ${s.siteUrl}.`, next: null, syncedAt: s.syncedAt };
}

function listing(f: GoogleHubFacts): Draft {
  const l = f.listing;
  if (f.signIn.needsReconnect) return { status: "blocked", line: WAITING_ON_SIGN_IN, next: null, syncedAt: l.syncedAt, setupOpen: false };
  // Its guide stays open until then: asking Google for access can start before the sign-in, and takes the longest.
  if (!f.signIn.connected) return { status: "off", line: "Not set up.", next: FIRST_SIGN_IN };
  if (!f.signIn.listingAllowed) return { status: "off", line: "Business Profile wasn't ticked at sign-in.", next: "Press Connect again and tick Business Profile." };
  const name = l.title ?? "The listing";
  if (l.error && !isApprovalWait(l.error)) return { status: "fix", line: l.error, next: AFTER_FIX, syncedAt: l.syncedAt };
  // With no access yet Google can't even list the listing, so "none found" usually means the same wait.
  if (isApprovalWait(l.error) || !l.location)
    return {
      status: "waiting",
      line: "Waiting on Google's OK. Your sign-in is fine; Google reviews each request by hand, usually within two weeks, and emails when it's approved.",
      next: "Then press Find again here.",
      setupOpen: false,
    };
  if (!l.hasData && !l.syncedAt) return { status: "working", line: `${name} is picked. The first numbers arrive after tonight's sync.`, next: null };
  return { status: "working", line: `Reading ${name}.`, next: null, syncedAt: l.syncedAt };
}

function analytics(f: GoogleHubFacts): Draft {
  return {
    status: "coming",
    line: f.signIn.needsReconnect ? "Waiting on your Google sign-in too. Google Analytics isn't brought in yet; it's being built next and will use the same sign-in." : "Not brought in yet. It's being built next and will use the same Google sign-in.",
    next: null,
    setupOpen: !f.signIn.needsReconnect,
  };
}

function reviews(r: GoogleHubFacts["reviews"]): Draft {
  if (!r.keySaved) return { status: "off", line: "Not set up. Reviews can still be pasted in on the Reviews page.", next: "Make a Google key and paste it below. About 5 minutes." };
  if (!r.placeId) return { status: "off", line: "The key is saved. No business is picked yet.", next: "Find your business below." };
  if (r.test && !r.test.ok) return { status: "fix", line: r.test.message, next: "Paste a new key below if Google stopped accepting this one." };
  if (r.fromListing) return { status: "working", line: `Follows your Google listing, ${r.placeName ?? "your business"}. New reviews come in every morning; Google only shares the five most relevant at a time.`, next: null, syncedAt: null };
  return { status: "working", line: `Linked to ${r.placeName ?? "your business"}. New reviews come in every morning; Google only shares the five most relevant at a time.`, next: null, syncedAt: null };
}

/** "2 working · 1 waiting on Google": each state once, in a fixed order, leaving out the empty ones. */
export function hubSummary(pieces: Pick<HubPiece, "status">[]): string {
  return ORDER.map((s) => [s, pieces.filter((p) => p.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${LOOK[s].count}`)
    .join(" · ");
}

/** The Google tile on Settings → Connections: one pill for the whole page. */
export function hubTileStatus(counts: Record<HubStatus, number>): { tone: HubTone; label: string } {
  if (counts.fix > 0) return { tone: "bad", label: "Needs fixing" };
  if (counts.working === 0) return { tone: "neutral", label: "Not set up" };
  if (counts.off > 0) return { tone: "warn", label: "Half done" };
  return { tone: "good", label: "On" };
}

export function googleHub(f: GoogleHubFacts): GoogleHub {
  const pieces = [make("signin", signIn(f.signIn)), make("search", search(f)), make("listing", listing(f)), make("analytics", analytics(f)), make("reviews", reviews(f.reviews))];
  const counts = Object.fromEntries(ORDER.map((s) => [s, pieces.filter((p) => p.status === s).length])) as Record<HubStatus, number>;
  return { pieces, counts, summary: hubSummary(pieces) };
}
