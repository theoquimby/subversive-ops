import type { MetadataRoute } from "next";

/** Makes the app installable (Add to Home Screen) — required for web push on iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Subversive Ops",
    short_name: "Subversive",
    description: "Shifts, prep, kegs, counts and waste for the Subversive team — and the numbers for managers.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    categories: ["business", "food", "productivity"],
    background_color: "#f7f7f5",
    theme_color: "#f7f7f5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    // Long-press the home-screen icon (Android; iOS ignores these). Staff-safe pages only.
    shortcuts: [
      { name: "Scan a keg", short_name: "Scan", url: "/kegs/scan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Prep list", short_name: "Prep", url: "/prep", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Log waste", short_name: "Waste", url: "/waste", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My shifts", short_name: "Shifts", url: "/my/shifts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
