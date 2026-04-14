/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  swcMinify: true,
  // serverExternalPackages is Next.js 15+; use experimental.serverComponentsExternalPackages for 14
  experimental: {
    serverComponentsExternalPackages: ['tesseract.js', 'node-hid', 'usb'],
    workerThreads: false,
    cpus: 1,
  },
}

export default nextConfig
