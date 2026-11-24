/**
 * DEV ONLY splash board. This file is a page only when next.config.js runs in
 * splash dev mode (pageExtensions gains "jsx"); production builds and the
 * static export never see it. getStaticProps is a second gate.
 */
import dynamic from 'next/dynamic'

const on = process.env.NEXT_PUBLIC_SEZS_SPLASH === '1' && process.env.NODE_ENV !== 'production'
const Board = on ? dynamic(() => import('../src/splash/Board'), { ssr: false }) : null

export const getStaticProps = () =>
  process.env.SEZS_SPLASH === '1' && process.env.NODE_ENV !== 'production' ? { props: {} } : { notFound: true }

const Splash = () => (Board ? <Board /> : null)
export default Splash
