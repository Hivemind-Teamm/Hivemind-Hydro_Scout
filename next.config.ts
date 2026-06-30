import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  serverExternalPackages: ['firebase-admin'],
};

export default nextConfig;