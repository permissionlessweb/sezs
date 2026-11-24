import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FONT_BOOT } from '../src/ui/fonts'
import { TONE_BOOT } from '../src/ui/tone'
import { withBasePath } from '../src/ui/basePath'
import { Head, Html, Main, NextScript } from 'next/document'

/**
 * next export does not emit `headers()`. Meta is the static-file fallback.
 * Origin headers (HSTS on TLS, nosniff, Permissions-Policy, frame-ancestors)
 * live in nginx `sezs-security-headers.inc` — include is a user decision.
 * CSP nonce/hash is not applied: a nonce needs a body rewrite, and a hash
 * would drop 'unsafe-inline' and break Next 13.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:19091 http://127.0.0.1:1317 http://127.0.0.1:26657 http://127.0.0.1:3050 http://127.0.0.1:3051 http://127.0.0.1:3052 http://127.0.0.1:3053 http://localhost:3050 http://localhost:3051 ws://127.0.0.1:3050 ws://127.0.0.1:3051 ws://localhost:3050 ws://localhost:3051 https://rpc.terp.network https://api.terp.network https://esm.sh https://cdn.jsdelivr.net",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const publicFromBootFile = () => {
  const envChain = (process.env.NEXT_PUBLIC_SEZS_CHAIN_ID || process.env.SEZS_CHAIN_ID || '').trim()
  if (envChain && !envChain.startsWith('sezs-local')) return {}
  if ((process.env.NEXT_PUBLIC_SEZS_EVENT_CONTRACT || process.env.NEXT_PUBLIC_SEZS_EVENTS || '').trim()) return {}
  const session = process.env.SEZS_V2_BOOT || (process.env.SEZS_SESSION_ROOT ? join(process.env.SEZS_SESSION_ROOT, 'terp-boot.json') : '')
  const fallback = join(process.cwd(), 'dev/localterp/boot.json')
  const path = session && existsSync(session) ? session : fallback
  if (!existsSync(path)) return {}
  try {
    const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const pick = (k: string) => (typeof j[k] === 'string' ? String(j[k]).trim() : '')
    return {
      contract: pick('contract'),
      lcd: pick('lcd'),
      chainId: pick('chainId'),
      raffle: pick('raffle'),
      randomness: pick('randomness'),
    }
  } catch {
    return {}
  }
}

const firstListedEvent = () =>
  (process.env.NEXT_PUBLIC_SEZS_EVENTS || '')
    .split(',')
    .map((s) => s.trim())
    .find(Boolean) || ''

const bootScript = () => {
  const file = publicFromBootFile()
  const chainId = process.env.NEXT_PUBLIC_SEZS_CHAIN_ID || process.env.SEZS_CHAIN_ID || file.chainId || ''
  const contract =
    process.env.NEXT_PUBLIC_SEZS_EVENT_CONTRACT ||
    process.env.SEZS_EVENT_CONTRACT ||
    firstListedEvent() ||
    file.contract ||
    ''
  const lcd =
    process.env.NEXT_PUBLIC_SEZS_LCD ||
    process.env.SEZS_LCD ||
    file.lcd ||
    (chainId === 'morocco-1' ? 'https://api.terp.network' : '')
  const events = (process.env.NEXT_PUBLIC_SEZS_EVENTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const boot = {
    contract,
    ...(events.length ? { events } : {}),
    lcd,
    chainId,
    raffle: process.env.NEXT_PUBLIC_SEZS_RAFFLE_CONTRACT || process.env.SEZS_RAFFLE_CONTRACT || file.raffle || '',
    randomness: process.env.NEXT_PUBLIC_SEZS_RANDOMNESS_CONTRACT || process.env.SEZS_RANDOMNESS_CONTRACT || file.randomness || '',
  }
  if (!boot.contract && !boot.chainId && !boot.lcd) return null
  return <script dangerouslySetInnerHTML={{ __html: 'window.__SEZS_BOOT = ' + JSON.stringify(boot) + ';' }} />
}

const Document = () => (

  <Html lang="en" data-font="zakura" data-tone="night">
    <Head>
      <meta httpEquiv="Content-Security-Policy" content={CSP} />
      <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
      <meta httpEquiv="Permissions-Policy" content="camera=(self), microphone=(), geolocation=(), payment=(), usb=()" />
      <meta name="referrer" content="strict-origin-when-cross-origin" />
      <link rel="icon" href={withBasePath("/favicon.svg")} type="image/svg+xml" />
      <link rel="icon" href={withBasePath("/favicon-32.png")} type="image/png" sizes="32x32" />
      <link rel="apple-touch-icon" href={withBasePath("/apple-touch-icon.png")} />
      <link rel="stylesheet" href={withBasePath("/sezs-assets/fonts/faces.css")} />
      <link rel="stylesheet" href={withBasePath("/sezs-fonts/faces.css")} />
      <link rel="preload" href={withBasePath("/sezs-fonts/silkscreen-400.woff2")} as="font" type="font/woff2" crossOrigin="anonymous" />
      <script dangerouslySetInnerHTML={{ __html: FONT_BOOT }} />
      <script dangerouslySetInnerHTML={{ __html: TONE_BOOT }} />
      {bootScript()}
    </Head>
    <body>
      <Main />
      <NextScript />
    </body>
  </Html>
)

export default Document
