/** @type {import('next').NextConfig} */
const splashDev = process.env.NEXT_PUBLIC_SEZS_SPLASH === '1' && process.env.NODE_ENV !== 'production'
const rawBase = (process.env.NEXT_PUBLIC_BASE_PATH || process.env.SEZS_BASE_PATH || '').trim().replace(/\/+$/, '')
const basePath = rawBase && !rawBase.startsWith('/') ? `/${rawBase}` : rawBase

const nextConfig = {
  reactStrictMode: true,
  output: splashDev ? undefined : 'export',
  trailingSlash: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  pageExtensions: ['tsx', 'ts'],
  ...(splashDev
    ? {
        rewrites: async () => {
          const emailAuth = (process.env.SEZS_EMAIL_AUTH_URL || '').replace(/\/$/, '')
          return [
            ...(emailAuth
              ? [{ source: '/sezs/auth/email/:path*', destination: `${emailAuth}/sezs/auth/email/:path*` }]
              : []),
            { source: '/sezs/:path*', destination: 'http://127.0.0.1:19091/sezs/:path*' },
          ]
        },
      }
    : {}),
}

module.exports = nextConfig
