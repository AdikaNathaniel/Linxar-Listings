import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Milestone 11: build the whole site as STATIC FILES (HTML, JS, CSS) into
  // web/out/, ready to upload to IPFS. No server needed to host it. (This is
  // why the photo-upload code moved to a Cloudflare Worker: static files
  // can't run server code or keep secrets.)
  output: "export",
  // Write each page as folder/index.html, which IPFS gateways serve reliably
  trailingSlash: true,
  // Next's image optimiser needs a server; we use plain <img> tags anyway
  images: { unoptimized: true },

  experimental: {
    agentFeedback: true,
  },
  // (The template's `cacheComponents` and `partialPrefetching` were removed:
  //  they're server-side rendering features, and a static export has no
  //  server. Next refuses to build with them: "PPR cannot be enabled in
  //  export mode".)
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
