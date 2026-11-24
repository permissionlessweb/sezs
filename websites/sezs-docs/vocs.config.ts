import { defineConfig } from 'vocs/config'

export default defineConfig({
  basePath: '/alpha/sezs/docs',
  title: 'Speak-Ez Sessions',
  description: 'Specs, guides, and notes for Speak-Ez Sessions',
  titleTemplate: '%s · Speak-Ez Sessions',
  logoUrl: {
    light: '/alpha/sezs/docs/sez-mark-light.svg',
    dark: '/alpha/sezs/docs/sez-mark.svg',
  },
  iconUrl: '/alpha/sezs/docs/favicon.svg',
  ogImageUrl: '/alpha/sezs/docs/og-banner.svg',
  renderStrategy: 'full-static',
  // Webapp tokens: core amber on a dark field; ember on cream in light mode.
  accentColor: 'light-dark(#a0521a, #ffb347)',
  checkDeadlinks: 'warn',
  topNav: [
    { text: 'Specs', link: '/specs' },
    { text: 'Guides', link: '/guides' },
    { text: 'Blog', link: '/blog' },
    { text: 'Disclaimers', link: '/disclaimers' },
    { text: 'Event', link: 'https://permissionless.money/alpha/sezs/', external: true },
  ],
  sidebar: [
    { text: 'Welcome', link: '/' },
    {
      text: 'Specs',
      collapsed: false,
      items: [
        { text: 'Specs', link: '/specs' },
        { text: 'Event contract', link: '/specs/event' },
        { text: 'Proof benchmarks', link: '/specs/event/benchmark' },
        { text: 'Ticketing', link: '/specs/ticketing' },
        { text: 'Digital gallery', link: '/specs/gallery' },
        { text: 'Admin capabilities', link: '/specs/admin' },
      ],
    },
    {
      text: 'Guides',
      collapsed: false,
      items: [
        { text: 'Guides', link: '/guides' },
        {
          text: 'General',
          collapsed: false,
          items: [
            { text: 'Install a wallet', link: '/guides/general/installing-a-wallet' },
            { text: 'Buy ZEC for the first time', link: '/guides/general/purchasing-zec' },
            { text: 'Buy a ticket', link: '/guides/general/purchasing-a-ticket' },
          ],
        },
        {
          text: 'Artists & vendors',
          collapsed: false,
          items: [
            { text: 'Submit payment addresses', link: '/guides/artists/submitting-wallet-addresses' },
            { text: 'Post art in the gallery', link: '/guides/artists/posting-art' },
          ],
        },
      ],
    },
    { text: 'Blog', link: '/blog' },
    { text: 'Disclaimers', link: '/disclaimers' },
  ],
})
