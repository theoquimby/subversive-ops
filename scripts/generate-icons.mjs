// Generates the PWA/notification PNG icons in public/icons from src/app/icon.svg.
// Run: node scripts/generate-icons.mjs  (uses sharp, which ships with Next.js)
import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const path = /<path d="([^"]+)"/.exec(svg)[1];
const out = new URL("../public/icons/", import.meta.url);
await mkdir(out, { recursive: true });

// Full-bleed square (maskable / Apple): the OS applies its own rounding, so keep the
// mark inside the central 60% safe zone.
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1b1a18"/><g transform="translate(16 16) scale(${scale}) translate(-16 -16)"><path d="${path}" fill="none" stroke="#f7f7f5" stroke-width="2.4" stroke-linecap="round"/></g></svg>`;
// Android status-bar badge: white mark on transparent, the system tints it.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g transform="translate(16 16) scale(1.25) translate(-16 -16)"><path d="${path}" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/></g></svg>`;

const jobs = [
  ["icon-192.png", svg, 192],
  ["icon-512.png", svg, 512],
  ["icon-maskable-512.png", fullBleed(0.8), 512],
  ["apple-touch-icon.png", fullBleed(0.95), 180],
  ["badge-96.png", badge, 96],
];
for (const [name, src, size] of jobs) {
  await sharp(Buffer.from(src), { density: (72 * size) / 32 }).resize(size, size).png().toFile(new URL(name, out).pathname);
  console.log("wrote", name);
}
