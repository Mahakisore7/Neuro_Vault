import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// The only origins the browser talks to besides this one: the API and
// Supabase (auth, plus avatar uploads to its storage).
const connectTo = [process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]
  .filter(Boolean)
  .join(" ");

// Content Security Policy without nonces (see node_modules/next/dist/docs/
// 01-app/02-guides/content-security-policy.md). Nonces would force every
// page to render dynamically, and next-themes' anti-flash script is inline,
// so script-src keeps 'unsafe-inline'. What this still buys: scripts only
// from this origin, no plugins, no <base> hijacking, no framing, and fetches
// only to the API and Supabase - an injected script can't send data
// anywhere else. 'unsafe-eval' is dev-only (React's dev error overlay).
// img-src allows https: because avatars come from Supabase storage or the
// Google account picture.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https:",
  "font-src 'self'",
  `connect-src 'self' ${connectTo}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // The floating "N" dev-tools badge next dev shows in a corner during
  // development - noise for anyone screen-sharing or demoing the app.
  devIndicators: false,
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
