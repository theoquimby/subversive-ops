/**
 * iPhone launch screens for the installed app (Add to Home Screen). iOS only
 * shows a splash when an image matches the exact screen, so there's one per
 * current iPhone size, light and dark. Made from the brand mark; regenerate
 * if the mark changes (public/icons/splash-*.png).
 */

// [device width, height in points, pixel ratio]
const SCREENS: [number, number, number][] = [
  [440, 956, 3], // 16 Pro Max
  [402, 874, 3], // 16 Pro
  [430, 932, 3], // 14/15 Pro Max, 15/16 Plus
  [393, 852, 3], // 14/15 Pro, 15/16
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [390, 844, 3], // 12/13/14, 12/13 Pro
  [375, 812, 3], // X/XS/11 Pro, 12/13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // SE, 8
];

const query = (w: number, h: number, r: number, dark: boolean) =>
  `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)${dark ? " and (prefers-color-scheme: dark)" : ""}`;

/** Dark first: where iOS can't tell, the light one (no colour-scheme condition) still matches. */
export const STARTUP_IMAGES = SCREENS.flatMap(([w, h, r]) => [
  { url: `/icons/splash-${w * r}x${h * r}-dark.png`, media: query(w, h, r, true) },
  { url: `/icons/splash-${w * r}x${h * r}.png`, media: query(w, h, r, false) },
]);
