import type { MetadataRoute } from "next";

/** Makes the app installable (Add to Home Screen) — required for web push on iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Subversive Ops",
    short_name: "Subversive",
    description: "Food costing, ordering, schedules and counts for Subversive.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f7f5",
    theme_color: "#f7f7f5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
