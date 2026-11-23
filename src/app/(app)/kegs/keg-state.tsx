import { BUCKET_LABEL, BUCKETS, type Bucket } from "@/domain/kegFleet";

/*
 * One colour per keg state, the same on every keg page (the Kegs home bar, Fleet & trends,
 * a beer's page), with the words from BUCKET_LABEL.
 *
 * The three states with beer in them take hues: full blue, on tap orange, out aqua.
 * Checked with the dataviz palette validator, all pairs, in both modes:
 *   light #2a78d6,#eb6834,#1baf7a on #ffffff: pass (worst CVD 9.2, normal 24.0; aqua 2.8:1,
 *     so every chart using it carries a key and the numbers beside it)
 *   dark  #3987e5,#d95926,#199e70 on #1a1a18: pass (worst CVD 9.4, normal 20.9, all 3:1+)
 * The two empty states are greys, darker for dirty (work to do), lighter for clean (ready):
 * no beer, no hue. Status colours (good, warn, bad) are never used for a state.
 */
const LIGHT = { full: "#2a78d6", tap: "#eb6834", out: "#1baf7a" };
const DARK = { full: "#3987e5", tap: "#d95926", out: "#199e70" };
const vars = (p: typeof LIGHT) => `--keg-full:${p.full};--keg-tap:${p.tap};--keg-out:${p.out};`;
const CSS = `:root{${vars(LIGHT)}--keg-dirty:var(--muted);--keg-clean:var(--border-strong);}@media (prefers-color-scheme: dark){:root{${vars(DARK)}}}`;

/** Puts the keg-state colours on the page. Rendered once, by the kegs layout. */
export function KegStateVars() {
  return <style>{CSS}</style>;
}

export const KEG_STATE_FILL: Record<Bucket, string> = {
  full: "var(--keg-full)",
  tap: "var(--keg-tap)",
  out: "var(--keg-out)",
  dirty: "var(--keg-dirty)",
  clean: "var(--keg-clean)",
};

/** The colour key for any chart of keg states. */
export const KEG_STATE_KEY = BUCKETS.map((b) => ({ key: b, label: BUCKET_LABEL[b], fill: KEG_STATE_FILL[b] }));
