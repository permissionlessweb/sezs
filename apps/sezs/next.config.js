/** @type {import('next').NextConfig} */
const splashDev = process.env.NEXT_PUBLIC_SEZS_SPLASH === '1' && process.env.NODE_ENV !== 'production'
const rawBase = (process.env.NEXT_PUBLIC_BASE_PATH || process.env.SEZS_BASE_PATH || '').trim().replace(/\/+$/, '')
const basePath = rawBase && !rawBase.startsWith('/') ? `/${rawBase}` : rawBase

const sezsBackend = (process.env.SEZS_BACKEND_URL || 'http://127.0.0.1:3058').replace(/\/$/, '')

const nextConfig = {
  reactStrictMode: true,
  output: splashDev ? undefined : 'export',
  trailingSlash: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  pageExtensions: ['tsx', 'ts'],
  ...(splashDev
    ? {
        rewrites: async () => [
          { source: '/sezs/:path*', destination: `${sezsBackend}/sezs/:path*` },
          { source: '/itl/:path*', destination: `${sezsBackend}/itl/:path*` },
        ],
      }
    : {}),
}

module.exports = nextConfig
