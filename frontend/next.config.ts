import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // ponytail: Turbopack's dev filesystem cache writes are slow on Windows NTFS/Defender,
    // causing 15-100s stalls. Re-enable if this ever gets fixed upstream for Windows.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
