import { describe, expect, it } from "vitest";
import { GOOGLE_HUB_HREF, googleHub, hubSummary, hubTileStatus, isApprovalWait, type GoogleHubFacts, type HubPiece } from "../googleHub";

const APPROVAL = "Google hasn't approved Business Profile API access for this project yet (its quota is 0). The sign-in is fine and Search Console still works. Google reviews each request by hand; nothing more is needed until it emails.";
const EXPIRED = "Google says the sign-in has expired or was removed. Press Connect Google again.";

const nothing = (): GoogleHubFacts => ({
  signIn: { clientIdSaved: false, clientSecretSaved: false, connected: false, connectedBy: null, connectedAt: null, needsReconnect: null, searchAllowed: false, listingAllowed: false },
  search: { siteUrl: null, syncedAt: null, error: null, hasData: false },
  listing: { location: null, title: null, syncedAt: null, error: null, hasData: false },
  reviews: { keySaved: false, placeId: null, placeName: null, test: null },
});

/** Sign-in done, Search Console picked and syncing, the listing waiting on Google's approval, reviews on. */
const usual = (): GoogleHubFacts => ({
  signIn: { clientIdSaved: true, clientSecretSaved: true, connected: true, connectedBy: "Max", connectedAt: "2026-11-14T15:00:00Z", needsReconnect: null, searchAllowed: true, listingAllowed: true },
  search: { siteUrl: "sc-domain:drinksubversive.com", syncedAt: "2026-11-16T07:00:00Z", error: null, hasData: true },
  listing: { location: null, title: null, syncedAt: "2026-11-16T07:00:00Z", error: APPROVAL, hasData: false },
  reviews: { keySaved: true, placeId: "ChIJabc123", placeName: "Subversive Brewing", test: { ok: true, message: "Working — Google answered the search.", at: "2026-11-10T12:00:00Z" } },
});

const piece = (pieces: HubPiece[], id: HubPiece["id"]) => pieces.find((p) => p.id === id)!;

describe("the Google page", () => {
  it("lists the five pieces in order, each feeding its page", () => {
    const h = googleHub(nothing());
    expect(h.pieces.map((p) => p.id)).toEqual(["signin", "search", "listing", "analytics", "reviews"]);
    expect(piece(h.pieces, "search").feeds).toEqual({ label: "Online › Overview", href: "/online" });
    expect(piece(h.pieces, "listing").feeds).toEqual({ label: "Online › Google listing", href: "/online/google" });
    expect(piece(h.pieces, "reviews").feeds).toEqual({ label: "Reviews", href: "/reviews" });
    expect(piece(h.pieces, "signin").feeds).toBeNull();
    expect(h.pieces.filter((p) => p.underSignIn).map((p) => p.id)).toEqual(["search", "listing", "analytics"]);
    expect(GOOGLE_HUB_HREF).toBe("/settings/connections/google");
  });

  it("with nothing set up, says so and opens each setup guide", () => {
    const h = googleHub(nothing());
    expect(h.pieces.map((p) => p.status)).toEqual(["off", "off", "off", "coming", "off"]);
    expect(h.summary).toBe("4 not set up · 1 coming next");
    const signIn = piece(h.pieces, "signin");
    expect(signIn.label).toBe("Not set up");
    expect(signIn.tone).toBe("neutral");
    expect(signIn.next).toMatch(/Client ID and secret/);
    expect(piece(h.pieces, "search").next).toBe("Do the Google sign-in above first.");
    expect(piece(h.pieces, "reviews").next).toMatch(/paste it below/);
    for (const p of h.pieces) expect(p.setupOpen, p.id).toBe(true);
  });

  it("asks for the other half when only one of the sign-in's two codes is saved", () => {
    const f = nothing();
    f.signIn.clientIdSaved = true;
    expect(piece(googleHub(f).pieces, "signin").next).toBe("Paste the Client secret too.");
  });

  it("asks to press Connect once both codes are saved", () => {
    const f = nothing();
    f.signIn.clientIdSaved = f.signIn.clientSecretSaved = true;
    const s = piece(googleHub(f).pieces, "signin");
    expect(s.status).toBe("off");
    expect(s.line).toBe("The Client ID and secret are saved.");
    expect(s.next).toMatch(/^Press Connect Google/);
  });

  it("reads calmly when the listing is only waiting on Google's approval", () => {
    const h = googleHub(usual());
    expect(h.pieces.map((p) => p.status)).toEqual(["working", "working", "waiting", "coming", "working"]);
    expect(h.summary).toBe("3 working · 1 waiting on Google · 1 coming next");
    const signIn = piece(h.pieces, "signin");
    expect(signIn.line).toBe("Connected by Max.");
    expect(signIn.next).toBeNull();
    expect(signIn.setupOpen).toBe(false);
    const search = piece(h.pieces, "search");
    expect(search.line).toBe("Reading sc-domain:drinksubversive.com.");
    expect(search.syncedAt).toBe("2026-11-16T07:00:00Z");
    const listing = piece(h.pieces, "listing");
    expect(listing.label).toBe("Waiting on Google");
    expect(listing.tone).toBe("neutral");
    expect(`${listing.line} ${listing.next}`).toBe("Waiting on Google's OK. Your sign-in is fine; Google reviews each request by hand, usually within two weeks, and emails when it's approved. Then press Find again here.");
    expect(listing.line).not.toMatch(/fix|error|quota/i);
    expect(listing.setupOpen).toBe(false);
    const analytics = piece(h.pieces, "analytics");
    expect(analytics.label).toBe("Coming next");
    expect(analytics.feeds).toEqual({ label: "Online › Website", href: "/website/analytics" });
    const reviews = piece(h.pieces, "reviews");
    expect(reviews.line).toMatch(/Subversive Brewing/);
    expect(reviews.line).toMatch(/five most relevant/);
    expect(reviews.setupOpen).toBe(false);
  });

  it("treats a signed-in listing with nothing found yet as the same wait", () => {
    const f = usual();
    f.listing.error = null;
    f.listing.syncedAt = null;
    expect(piece(googleHub(f).pieces, "listing").status).toBe("waiting");
  });

  it("when the sign-in needs connecting again, says it once and the rows under it wait on it", () => {
    const f = usual();
    f.signIn.connected = false;
    f.signIn.needsReconnect = EXPIRED;
    f.search.error = "Google asked to sign in again. Press Connect Google.";
    f.listing.error = "Google asked to sign in again. Press Connect Google.";
    const h = googleHub(f);
    const signIn = piece(h.pieces, "signin");
    expect(signIn.status).toBe("fix");
    expect(signIn.label).toBe("Needs fixing");
    expect(signIn.tone).toBe("bad");
    expect(signIn.line).toBe(EXPIRED);
    expect(signIn.next).toBe("Press Connect again.");
    for (const id of ["search", "listing", "analytics"] as const) {
      const p = piece(h.pieces, id);
      expect(p.line, id).toMatch(/^Waiting on your Google sign-in/);
      expect(p.line, id).not.toMatch(/asked to sign in/);
      expect(p.next, id).toBeNull();
      expect(p.setupOpen, id).toBe(false);
    }
    expect(piece(h.pieces, "search").status).toBe("blocked");
    expect(piece(h.pieces, "search").label).toBe("Waiting on sign-in");
    expect(piece(h.pieces, "listing").status).toBe("blocked");
    expect(piece(h.pieces, "analytics").status).toBe("coming");
    expect(h.summary).toBe("1 working · 1 needs fixing · 2 waiting on the sign-in · 1 coming next");
  });

  it("asks for the codes again when the sign-in lost them", () => {
    const f = usual();
    f.signIn.connected = false;
    f.signIn.needsReconnect = "The Google Client ID or secret was removed. Paste them again.";
    f.signIn.clientSecretSaved = false;
    expect(piece(googleHub(f).pieces, "signin").next).toBe("Paste the Client ID and secret again, then press Connect again.");
  });

  it("with the reviews key saved but no business picked, the one step left is finding it", () => {
    const f = usual();
    f.reviews.placeId = null;
    f.reviews.placeName = null;
    const r = piece(googleHub(f).pieces, "reviews");
    expect(r.status).toBe("off");
    expect(r.line).toBe("The key is saved. No business is picked yet.");
    expect(r.next).toBe("Find your business below.");
    expect(r.setupOpen).toBe(true);
  });

  it("flags a failed reviews test with Google's words", () => {
    const f = usual();
    f.reviews.test = { ok: false, message: "Google didn't accept the key.", at: "2026-11-15T12:00:00Z" };
    const r = piece(googleHub(f).pieces, "reviews");
    expect(r.status).toBe("fix");
    expect(r.line).toBe("Google didn't accept the key.");
    expect(r.next).toMatch(/new key/);
  });

  it("shows a real listing error as needing a fix, not as the approval wait", () => {
    const f = usual();
    f.listing.location = "locations/123";
    f.listing.title = "Subversive Brewing";
    f.listing.error = "Google refused: the signed-in account can't see this property or listing.";
    const l = piece(googleHub(f).pieces, "listing");
    expect(l.status).toBe("fix");
    expect(l.tone).toBe("bad");
    expect(l.line).toBe(f.listing.error);
    expect(l.next).toMatch(/Sync now/);
  });

  it("calls the listing working once it reads, and says when it's picked but not read yet", () => {
    const f = usual();
    f.listing = { location: "locations/123", title: "Subversive Brewing", syncedAt: "2026-11-16T07:00:00Z", error: null, hasData: true };
    expect(piece(googleHub(f).pieces, "listing")).toMatchObject({ status: "working", line: "Reading Subversive Brewing." });
    f.listing = { location: "locations/123", title: "Subversive Brewing", syncedAt: null, error: null, hasData: false };
    expect(piece(googleHub(f).pieces, "listing")).toMatchObject({ status: "working", line: "Subversive Brewing is picked. The first numbers arrive after tonight's sync." });
  });

  it("asks to connect again when a part wasn't ticked at sign-in", () => {
    const f = usual();
    f.signIn.listingAllowed = false;
    f.signIn.searchAllowed = false;
    const h = googleHub(f);
    expect(piece(h.pieces, "listing").next).toBe("Press Connect again and tick Business Profile.");
    expect(piece(h.pieces, "search").next).toBe("Press Connect again and tick Search Console.");
  });

  it("asks to pick the website's property when none is picked", () => {
    const f = usual();
    f.search = { siteUrl: null, syncedAt: null, error: null, hasData: false };
    expect(piece(googleHub(f).pieces, "search")).toMatchObject({ status: "off", next: "Pick the website's property below, or press Find again." });
  });
});

describe("approval wait", () => {
  it("knows Google's zero-quota answer from other errors", () => {
    expect(isApprovalWait(APPROVAL)).toBe(true);
    expect(isApprovalWait("Google hasn't approved Business Profile API access for this project yet (its quota is 0). Search Console still works. See How to set this up under Google listing (Settings → Connections → Google).")).toBe(true);
    expect(isApprovalWait("Google refused: no access.")).toBe(false);
    expect(isApprovalWait(null)).toBe(false);
  });
});

describe("the Connections tile", () => {
  it("sums the page up in one pill", () => {
    expect(hubTileStatus(googleHub(nothing()).counts)).toEqual({ tone: "neutral", label: "Not set up" });
    expect(hubTileStatus(googleHub(usual()).counts)).toEqual({ tone: "good", label: "On" });
    const half = usual();
    half.reviews = { keySaved: false, placeId: null, placeName: null, test: null };
    expect(hubTileStatus(googleHub(half).counts)).toEqual({ tone: "warn", label: "Half done" });
    const broken = usual();
    broken.signIn.connected = false;
    broken.signIn.needsReconnect = EXPIRED;
    expect(hubTileStatus(googleHub(broken).counts)).toEqual({ tone: "bad", label: "Needs fixing" });
  });
});

describe("summary line", () => {
  it("counts each state once, leaving out the empty ones", () => {
    expect(hubSummary([{ status: "working" }, { status: "working" }, { status: "waiting" }])).toBe("2 working · 1 waiting on Google");
    expect(hubSummary([])).toBe("");
  });
});
