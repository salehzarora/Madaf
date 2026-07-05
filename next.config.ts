import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile exists in the user home dir
  // and would otherwise be inferred as the workspace root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
