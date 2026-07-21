import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        output: "export",
        basePath: "/hannna-purchase",
        assetPrefix: "/hannna-purchase/",
        trailingSlash: true,
        images: { unoptimized: true },
        // The Pages export does not use the Cloudflare-only worker/database
        // examples, whose runtime types are supplied by the Sites build.
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
};

export default nextConfig;
