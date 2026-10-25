import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/**
 * Le dashboard et l'API partagent la même origine grâce aux réécritures :
 * le cookie de session reste "first-party" et aucune configuration CORS n'est nécessaire.
 */
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/oauth/:path*", destination: `${API_URL}/oauth/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
