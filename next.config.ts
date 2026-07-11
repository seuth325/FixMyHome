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
};

export default nextConfig;
