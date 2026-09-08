/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Dockerfile copies .next/standalone; without this that directory is never built.
  output: "standalone",
  images: {
    // Card art is Riot's and is served from their CDN. It is referenced, never rehosted.
    remotePatterns: [{ protocol: "https", hostname: "cmsassets.rgpub.io" }],
  },
};
export default nextConfig;
