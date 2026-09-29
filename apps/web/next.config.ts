import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (only traced files and production deps).
  output: 'standalone',
  // Monorepo root, so tracing includes workspace packages such as @solmira/contracts.
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
