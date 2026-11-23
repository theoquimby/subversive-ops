/**
 * Position colours on the schedule, shift cards and the team pages.
 *
 * A position's stored colour is only taken as a hue family: red, green and
 * amber mean bad, good and warn everywhere else in the app, so a red Line cook
 * chip next to a red labor % read as a problem. Each family maps to one slot
 * of a five-hue palette kept off the status hues, defined light and dark as
 * `--pos-*` in globals.css. Validated as a set (adjacent order blue, orange,
 * aqua, violet, magenta) with the dataviz palette validator in both modes;
 * every chip also carries its position's name, so colour is never the only cue.
 */
export type PositionSlot = "blue" | "orange" | "aqua" | "violet" | "magenta";

function hueOf(hex: string): { h: number; s: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s };
}

/** The palette slot for a stored position colour. */
export function positionSlot(stored: string | null | undefined): PositionSlot {
  const c = stored ? hueOf(stored) : null;
  if (!c || c.s < 0.25) return "magenta"; // greys
  const { h } = c;
  if (h < 15 || h >= 345) return "violet"; // reds: as far from "bad" as the palette goes
  if (h < 70) return "orange"; // oranges, ambers, yellows
  if (h < 170) return "aqua"; // greens
  if (h < 255) return "blue"; // cyans and blues
  return "magenta"; // violets and pinks
}

/** A CSS colour for a stored position colour, right in light and dark. */
export const positionColor = (stored: string | null | undefined) => `var(--pos-${positionSlot(stored)})`;
