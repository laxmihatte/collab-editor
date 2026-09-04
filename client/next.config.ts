import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle with only the node_modules actually
  // reached at runtime. The production image copies that instead of installing
  // dependencies, which is what keeps it small.
  output: 'standalone',
};

export default nextConfig;
