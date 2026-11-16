/**
 * Timing profiles: when a brew is dry hopped, moved to a brite, packaged and
 * released, in days from brew day. The four profiles are Brew Manager's
 * (Zane's own app); a recipe's own dry-hop and release days win over its
 * profile, and a recipe with no profile uses its fermenting and conditioning
 * days.
 *
 * THE SNAPPING RULE. Transfers and packaging happen on set weekdays (by
 * default transfers on Monday or Tuesday, packaging on Wednesday). The day a
 * profile gives is moved to the nearest allowed weekday within three days
 * either side; when two are equally near, the earlier one. Nothing allowed
 * within three days (or no days set) leaves the day as it is. Dry hops and
 * release days are not snapped. Packaging always lands after the transfer.
 * Pure: plain data in, plain data out.
 */

import { addDays, daysBetween, nextWeekdayOnOrAfter, WEEKDAYS, weekday, type ISODate } from "./dates";

export type ProfileKey = "hazy" | "sour" | "lager" | "pale";

export interface TimingProfile {
  key: ProfileKey;
  label: string;
  /** One line on what it's for. */
  hint: string;
  /** Days from brew day. null = none. */
  dryHop: number | null;
  /** Fermenter-to-fermenter move (lagers). */
  fvTransfer: number | null;
  /** Into the brite tank. */
  brite: number;
  pkg: number;
  /** On tap / released. */
  tap: number;
}

export const BREW_PROFILES: Record<ProfileKey, TimingProfile> = {
  hazy: { key: "hazy", label: "Hazy IPA", hint: "Dry hop day 7, brite day 20, package 23, on tap 30", dryHop: 7, fvTransfer: null, brite: 20, pkg: 23, tap: 30 },
  sour: { key: "sour", label: "Sour", hint: "About six weeks: brite day 38, package 42, on tap 49", dryHop: null, fvTransfer: null, brite: 38, pkg: 42, tap: 49 },
  lager: { key: "lager", label: "Lager", hint: "About eight weeks: fermenter move day 21, brite 49, package 52, on tap 60", dryHop: null, fvTransfer: 21, brite: 49, pkg: 52, tap: 60 },
  pale: { key: "pale", label: "Pale / Clear IPA", hint: "About five weeks: brite day 32, package 35, on tap 42", dryHop: null, fvTransfer: null, brite: 32, pkg: 35, tap: 42 },
};

export const PROFILE_KEYS = Object.keys(BREW_PROFILES) as ProfileKey[];
export const isProfileKey = (s: unknown): s is ProfileKey => typeof s === "string" && Object.prototype.hasOwnProperty.call(BREW_PROFILES, s);

/** A brew's own choice to use the recipe's fermenting and conditioning days, whatever the recipe's profile. */
export const RECIPE_DAYS = "days";

/** "Hazy IPA"; a custom key as written; no profile (or RECIPE_DAYS) → "Recipe days". */
export const profileLabel = (key: string | null | undefined) => (isProfileKey(key) ? BREW_PROFILES[key].label : key?.trim() && key !== RECIPE_DAYS ? key.trim() : "Recipe days");

/** Brew Manager's guess from the style and name: hazy, sour, lager, else pale. */
export function guessProfile(style: string | null | undefined, name: string | null | undefined): ProfileKey {
  const s = (style ?? name ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (/hazy|neipa|nyipa/.test(s) || n.includes("nectar")) return "hazy";
  if (/sour|farmhouse|gose/.test(s)) return "sour";
  if (/lager|pils|märzen|marzen|festbier/.test(s)) return "lager";
  return "pale";
}

// ---- Weekdays ------------------------------------------------------------------------------------

export interface SnapRules {
  /** Weekdays (0 = Sunday) transfers happen on. Empty = any day. */
  transferDays: readonly number[];
  /** Weekdays packaging happens on. Empty = any day. */
  packageDays: readonly number[];
}

export const DEFAULT_SNAP: SnapRules = { transferDays: [1, 2], packageDays: [3] };
export const SNAP_REACH = 3;

/** The nearest day on an allowed weekday within `reach` days either side (earlier wins a tie); otherwise `target`. */
export function snapToDays(target: ISODate, allowed: readonly number[], reach = SNAP_REACH): ISODate {
  if (!allowed.length) return target;
  for (let d = 0; d <= reach; d++) {
    for (const off of d === 0 ? [0] : [-d, d]) {
      const day = addDays(target, off);
      if (allowed.includes(weekday(day))) return day;
    }
  }
  return target;
}

/** Packaging near `nominal`, snapped, and always after `transferOn` (the next allowed day after it if snapping pulls it back). */
export function packageAfter(transferOn: ISODate, nominal: ISODate, allowed: readonly number[]): ISODate {
  const snapped = snapToDays(nominal, allowed);
  if (snapped > transferOn) return snapped;
  return nextWeekdayOnOrAfter(addDays(transferOn, 1), allowed) ?? addDays(transferOn, 1);
}

/** "1,2" → [1, 2]; blank or unreadable → `fallback`; "none" → [] (any day). */
export function parseWeekdays(raw: string | null | undefined, fallback: readonly number[]): number[] {
  const v = (raw ?? "").trim();
  if (v === "none") return [];
  const days = [...new Set(v.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6 && v !== ""))].sort((a, b) => a - b);
  return days.length ? days : [...fallback];
}

/** [1, 2] → "Mon or Tue". */
export function weekdaysText(days: readonly number[]): string {
  const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d]);
  if (!names.length) return "any day";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// ---- A brew's dates ------------------------------------------------------------------------------

export interface TimingSource {
  /** A profile key; null or one Ops doesn't know uses the recipe's days. */
  profile: string | null;
  /** The recipe's own days, which win over the profile's. */
  dryHopDay: number | null;
  tapDay: number | null;
  fermentDays: number;
  conditionDays: number;
}

export interface ReleaseCheck {
  /** The release day is locked (a release event). */
  locked: boolean;
  /** The brew gets its full time before the locked release. */
  ok: boolean;
  /** The last brew day that still makes a locked release. */
  brewBy: ISODate | null;
}

export interface BrewTiming {
  brewOn: ISODate;
  profile: ProfileKey | null;
  dryHopOn: ISODate | null;
  /** Lagers: the fermenter-to-fermenter move. */
  fvTransferOn: ISODate | null;
  /** Into the brite (or, with no conditioning days, the same as packaging). */
  transferOn: ISODate;
  packageOn: ISODate;
  tapOn: ISODate;
  /** Days in the fermenter (brew day to transfer) and in the brite (transfer to packaging). */
  fermentDays: number;
  conditionDays: number;
  /** Days from brew day to its own release day (before any lock). */
  tapDays: number;
  release: ReleaseCheck;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: ISODate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/**
 * A brew's dates from its brew day: profile days (or the recipe's own),
 * transfers and packaging snapped to the brewery's weekdays. With a locked
 * release day, `tapOn` is that day and `release` says whether this brew day
 * still gives the beer its full time (and the last brew day that does).
 */
export function brewTiming(brewOn: ISODate, src: TimingSource, rules: SnapRules, lockedTapOn?: ISODate | null): BrewTiming {
  const p = isProfileKey(src.profile) ? BREW_PROFILES[src.profile] : null;
  const briteDay = Math.max(1, p ? p.brite : src.fermentDays);
  const pkgDay = p ? p.pkg : briteDay + Math.max(0, src.conditionDays);
  const after = (d: ISODate) => (d > brewOn ? d : null);
  let transferOn: ISODate;
  let packageOn: ISODate;
  if (pkgDay <= briteDay) {
    // Nothing to condition: packaged from the fermenter.
    packageOn = after(snapToDays(addDays(brewOn, briteDay), rules.packageDays)) ?? addDays(brewOn, briteDay);
    transferOn = packageOn;
  } else {
    transferOn = after(snapToDays(addDays(brewOn, briteDay), rules.transferDays)) ?? addDays(brewOn, briteDay);
    packageOn = packageAfter(transferOn, addDays(brewOn, pkgDay), rules.packageDays);
  }
  const fvTransferOn = p?.fvTransfer ? snapToDays(addDays(brewOn, p.fvTransfer), rules.transferDays) : null;
  const dryHopDay = src.dryHopDay ?? p?.dryHop ?? null;
  const tapDay = src.tapDay ?? p?.tap ?? pkgDay + 7;
  const naturalTap = addDays(brewOn, tapDay) > packageOn ? addDays(brewOn, tapDay) : packageOn;
  const tapDays = daysBetween(brewOn, naturalTap);
  const release: ReleaseCheck = lockedTapOn
    ? { locked: true, ok: naturalTap <= lockedTapOn && packageOn <= lockedTapOn, brewBy: addDays(lockedTapOn, -tapDays) }
    : { locked: false, ok: true, brewBy: null };
  return {
    brewOn,
    profile: p?.key ?? null,
    dryHopOn: dryHopDay != null ? addDays(brewOn, dryHopDay) : null,
    fvTransferOn,
    transferOn,
    packageOn,
    tapOn: lockedTapOn ?? naturalTap,
    fermentDays: daysBetween(brewOn, transferOn),
    conditionDays: daysBetween(transferOn, packageOn),
    tapDays,
    release,
  };
}

/** "Brew by Nov 19 to keep the release on Dec 19." when a locked release can't be made; otherwise null. */
export function releaseMessage(r: ReleaseCheck, lockedTapOn: ISODate | null | undefined): string | null {
  if (!r.locked || r.ok || !r.brewBy || !lockedTapOn) return null;
  return `Brew by ${md(r.brewBy)} to keep the release on ${md(lockedTapOn)}.`;
}
