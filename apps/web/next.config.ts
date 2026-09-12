import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  transpilePackages: ["@fintwin/contracts", "@fintwin/ui"],
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
