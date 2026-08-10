import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  outputFileTracingRoot: fixtureRoot,
};

export default nextConfig;
