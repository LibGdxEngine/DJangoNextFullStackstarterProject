import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // BFF mutations use Django-style trailing slashes and reject redirects.
  skipTrailingSlashRedirect: true,
};


export default nextConfig;
