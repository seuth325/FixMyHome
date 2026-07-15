import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Hostinger's shared hosting caps concurrent processes/threads per account
  // (CloudLinux LVE). Both Turbopack's Rust thread pool and Next's own build
  // workers default to a per-CPU-core pool that exceeds that cap and crashes
  // with EAGAIN. Force everything down to a single worker.
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  // The separate type-check subprocess Next spawns during `build` also hits
  // the process-fork limit above. tsc --noEmit is already run locally before
  // every deploy, so skip the redundant in-build subprocess.
  typescript: { ignoreBuildErrors: true },
  async headers() {
    const noStoreHeaders = [
      { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Pragma', value: 'no-cache' },
      { key: 'Expires', value: '0' },
    ];

    return [
      {
        source: '/:path*',
        headers: noStoreHeaders,
      },
      {
        source: '/_next/static/:path*',
        headers: noStoreHeaders,
      },
    ];
  },
};

export default nextConfig;
