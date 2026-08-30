import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fintwin/contracts", "@fintwin/ui"],
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
