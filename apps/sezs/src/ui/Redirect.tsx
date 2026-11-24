import Head from 'next/head'
import Link from 'next/link'
import { useEffect } from 'react'

/** Static-export redirect: 200 page that replaces itself on load. */
export const Redirect = ({ to, label }: { to: string; label: string }) => {
  useEffect(() => {
    window.location.replace(to)
  }, [to])
  return (
    <>
      <Head>
        <title>{label} · The event</title>
        <meta httpEquiv="refresh" content={`0; url=${to}`} />
        <link rel="canonical" href={to} />
      </Head>
      <p className="redirect-note">
        Moving to <Link href={to}>{label}</Link>…
      </p>
    </>
  )
}
