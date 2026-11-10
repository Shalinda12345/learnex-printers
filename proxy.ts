import { NextResponse, type NextRequest } from "next/server";

/* =====================================================================
   Content-Security-Policy for the pages (see node_modules/next/dist/docs/
   01-app/02-guides/content-security-policy.md).

   Every page view gets a fresh random nonce; only scripts carrying it (and the
   scripts those load) may run. So even if hostile text ever reached the page as
   markup, an injected <script> or onerror="..." would be refused by the browser.
   Next puts the nonce on its own scripts by itself because the page is rendered
   per request (see app/layout.tsx).

   Styles stay 'unsafe-inline': the app sets style="" attributes in many places,
   and a nonce cannot cover those. There is deliberately no
   `upgrade-insecure-requests`: the app is served over plain HTTP on the shop's
   network unless a TLS proxy is put in front of it.
===================================================================== */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    // React needs eval in development only (to rebuild server stack traces in the browser)
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // photos of bills are kept as data: URLs
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: not the JSON API, scripts, images or the icon
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
