import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    // Production images are resized by Cloudflare Image Transformations
    // (/cdn-cgi/image/...), see src/lib/image-loader.ts and ARCHITECTURE.md.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
  },
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
  // The Content-Security-Policy carries a per-request nonce and is set in
  // src/proxy.ts. These static headers apply to every response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

// Local bindings (D1/R2 via Miniflare) for `next dev` only.
if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();
