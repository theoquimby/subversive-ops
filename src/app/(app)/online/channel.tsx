/*
 * One colour per place a guest finds Subversive, the same on every Online and Website page:
 * Google Search, the Google listing, Google Maps (where the listing is shown), the website,
 * Instagram and the Facebook Page. Everything people do on their own (typed in, email,
 * other sites) stays grey.
 *
 * Checked with the dataviz palette validator, in both modes, on the pairs that sit together:
 *   all six, in this order, adjacent: pass
 *     light #2a78d6,#1baf7a,#eb6834,#6250d6,#e87ba4,#eda100 on #ffffff
 *     dark  #3987e5,#199e70,#d95926,#9085e9,#d55181,#c98500 on #1a1a18
 *   Maps beside Search, Search beside the listing, Instagram beside Facebook: all pairs, pass.
 *   Listing, website, Instagram, Facebook (What they did next, in that order): adjacent, pass.
 * Three light steps (aqua, magenta, yellow) are under 3:1 on white, so every chart using
 * them names each part beside its mark and carries the numbers.
 */
const LIGHT = { search: "#2a78d6", listing: "#1baf7a", maps: "#eb6834", website: "#6250d6", instagram: "#e87ba4", facebook: "#eda100" };
const DARK = { search: "#3987e5", listing: "#199e70", maps: "#d95926", website: "#9085e9", instagram: "#d55181", facebook: "#c98500" };

export type ChannelKey = keyof typeof LIGHT;

const vars = (p: typeof LIGHT) => (Object.keys(p) as ChannelKey[]).map((k) => `--ch-${k}:${p[k]};`).join("");
const CSS = `:root{${vars(LIGHT)}}@media (prefers-color-scheme: dark){:root{${vars(DARK)}}}`;

/** Puts the channel colours on the page. Rendered once by the Online and Website layouts. */
export function ChannelVars() {
  return <style>{CSS}</style>;
}

export const CHANNEL: Record<ChannelKey, string> = {
  search: "var(--ch-search)",
  listing: "var(--ch-listing)",
  maps: "var(--ch-maps)",
  website: "var(--ch-website)",
  instagram: "var(--ch-instagram)",
  facebook: "var(--ch-facebook)",
};
