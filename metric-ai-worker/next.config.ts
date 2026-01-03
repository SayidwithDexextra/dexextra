import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // Ensure Next doesn't accidentally infer the monorepo/workspace root from an unrelated lockfile.
    root: configDir
  }
};

export default nextConfig;


