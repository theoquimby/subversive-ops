import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: { default: "Subversive Ops", template: "%s · Subversive Ops" },
  description: "Food costing, ordering and inventory for Subversive.",
  robots: { index: false, follow: false },
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Subversive Ops", statusBarStyle: "default" },
  // Read by client components (date picker "Today") so they use the business date, not the browser's.
  other: { "business-tz": env.BUSINESS_TIMEZONE },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
