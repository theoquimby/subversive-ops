/**
 * Feedback sent from the Feedback button on any page: the kinds and statuses,
 * the device line, the page title, and checks on what comes in. Pure: no DB,
 * no React.
 */

export type FeedbackKind = "idea" | "problem" | "question" | "praise";
export type FeedbackStatus = "new" | "planned" | "done" | "wont";
export type FeedbackTone = "good" | "warn" | "bad" | "neutral";

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "problem", label: "Problem" },
  { value: "question", label: "Question" },
  { value: "praise", label: "Love it" },
];

export const FEEDBACK_STATUSES: { value: FeedbackStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "planned", label: "Planned" },
  { value: "done", label: "Done" },
  { value: "wont", label: "Won't do" },
];

/** Still to deal with: the inbox shows these by default. */
export const OPEN_STATUSES: FeedbackStatus[] = ["new", "planned"];

export const asFeedbackKind = (raw: string | null | undefined): FeedbackKind => FEEDBACK_KINDS.find((k) => k.value === raw)?.value ?? "idea";
export const asFeedbackStatus = (raw: string | null | undefined): FeedbackStatus => FEEDBACK_STATUSES.find((s) => s.value === raw)?.value ?? "new";
export const feedbackKindLabel = (raw: string | null | undefined) => FEEDBACK_KINDS.find((k) => k.value === asFeedbackKind(raw))!.label;
export const feedbackStatusLabel = (raw: string | null | undefined) => FEEDBACK_STATUSES.find((s) => s.value === asFeedbackStatus(raw))!.label;

const TONES: Record<FeedbackStatus, FeedbackTone> = { new: "neutral", planned: "warn", done: "good", wont: "neutral" };
export const feedbackStatusTone = (raw: string | null | undefined): FeedbackTone => TONES[asFeedbackStatus(raw)];

export const roleLabel = (role: string | null | undefined) => (role === "MANAGER" ? "Manager" : role === "STAFF" ? "Staff" : "");

/** Longest note we keep. */
export const FEEDBACK_MAX_CHARS = 5000;

export function validateFeedback(input: { kind: string; body: string }): { kind: FeedbackKind; body: string } | { error: string } {
  const body = input.body.trim();
  if (!body) return { error: "Write a few words first." };
  if (body.length > FEEDBACK_MAX_CHARS) return { error: `That's a lot — keep it under ${FEEDBACK_MAX_CHARS.toLocaleString("en-US")} characters, or send it in two.` };
  return { kind: asFeedbackKind(input.kind), body };
}

/**
 * "iPhone · Safari" from the browser's user agent. `touch`: the screen takes
 * touches (an iPad reports itself as a Mac). `installed`: running as the
 * home-screen app, where the browser name means little.
 */
export function deviceLabel(ua: string, opts: { touch?: boolean; installed?: boolean } = {}): string {
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && opts.touch)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  if (!device) return "Unknown device";
  if (opts.installed) return `${device} · app`;
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /CriOS\/|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS\/|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return browser ? `${device} · ${browser}` : device;
}

/** The browser tab's title without the app name ("Tanks · Subversive Ops" → "Tanks"). */
export function cleanPageTitle(title: string): string {
  const t = title.trim();
  if (t === "Subversive Ops") return "";
  return t.replace(/\s*[·|—-]\s*Subversive Ops$/, "").trim();
}

/** Photos are shrunk in the browser to about this before sending. */
export const FEEDBACK_PHOTO_MAX = 1024 * 1024;

const PHOTO_MIME = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** A photo sent as a data URL, checked to really be a JPEG, PNG or WebP. */
export function parsePhotoDataUrl(dataUrl: string, max = FEEDBACK_PHOTO_MAX): { mime: string; bytes: Uint8Array } | { error: string } {
  const m = PHOTO_MIME.exec(dataUrl.trim());
  if (!m) return { error: "That file isn't a photo we can read. Use a JPEG, PNG or WebP." };
  let bin: string;
  try {
    bin = atob(m[2]);
  } catch {
    return { error: "That file isn't a photo we can read. Use a JPEG, PNG or WebP." };
  }
  if (bin.length > max) return { error: "That photo is too big. Try again — it's shrunk before sending." };
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const mime = m[1];
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!((png && mime === "image/png") || (jpg && mime === "image/jpeg") || (webp && mime === "image/webp"))) return { error: "That file isn't a photo we can read. Use a JPEG, PNG or WebP." };
  return { mime, bytes };
}

/** One quiet line for the morning brief, or null when there's nothing new. */
export function newFeedbackLine(count: number): string | null {
  if (count <= 0) return null;
  return `${count} new feedback note${count === 1 ? "" : "s"}`;
}
