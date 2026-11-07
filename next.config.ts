import type { NextConfig } from 'next';
const config: NextConfig = { output: 'standalone', serverExternalPackages: ['pdf-parse', 'mammoth'], turbopack: { root: process.cwd() } };
export default config;
