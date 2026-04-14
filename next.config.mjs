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
  serverExternalPackages: ['tesseract.js', 'node-hid', 'usb'],
  experimental: {
    // Reduces memory usage during build by processing pages one at a time
    workerThreads: false,
    cpus: 1,
  },
}

export default nextConfig
