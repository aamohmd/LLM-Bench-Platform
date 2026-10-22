/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@visx/axis",
    "@visx/bounds",
    "@visx/curve",
    "@visx/event",
    "@visx/grid",
    "@visx/group",
    "@visx/point",
    "@visx/responsive",
    "@visx/scale",
    "@visx/shape",
    "@visx/text",
    "@visx/tooltip",
    "@visx/vendor",
    "d3-array",
    "d3-time-format"
  ],
  // NOTE: no rewrites — all /api/* traffic goes through app/api/[...path]/route.ts,
  // which injects the admin_api_key cookie as X-API-Key. A rewrite here would
  // bypass auth and send requests to the backend unauthenticated.
}

export default nextConfig;
