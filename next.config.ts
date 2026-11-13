import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "12mb" } }, // price sheet uploads
};

export default nextConfig;
