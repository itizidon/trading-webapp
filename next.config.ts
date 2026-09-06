import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // The API checker is deterministic in constrained build environments.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
