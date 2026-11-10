import type { NextConfig } from "next";

// Headers every response carries: pages, scripts and the JSON API.
// (The Content-Security-Policy of the pages is built per request in proxy.ts.)
const securityHeaders = [
  // never guess a different type for a file than the one the server says
  { key: "X-Content-Type-Options", value: "nosniff" },
  // no other website may show this app in a frame (clickjacking)
  { key: "X-Frame-Options", value: "DENY" },
  // nothing about where you were is sent to other sites
  { key: "Referrer-Policy", value: "same-origin" },
  // the app never needs these browser features, so nothing injected could use them either
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Load the MySQL driver with Node's own require instead of bundling it.
  serverExternalPackages: ["mysql2"],
  // Don't announce "X-Powered-By: Next.js" to everyone.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // JSON answers are never pages: nothing may be loaded from them or framed.
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
      },
      // Behind an HTTPS proxy: tell browsers to keep using HTTPS for this site.
      // (Only for requests that came in over HTTPS; browsers ignore it over plain HTTP.)
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }],
      },
    ];
  },
};

export default nextConfig;
