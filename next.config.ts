import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the MySQL driver with Node's own require instead of bundling it.
  serverExternalPackages: ["mysql2"],
};

export default nextConfig;
