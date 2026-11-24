export const CAL_ORIGIN =
  process.env.NEXT_PUBLIC_SEZS_CAL_ORIGIN || 'https://cal.com'

export const CAL_SLUG = 'sezs-speakeasy/discovery'

export const calEmbedUrl = (slug = CAL_SLUG) =>
  `${CAL_ORIGIN.replace(/\/$/, '')}/${slug}?embed=true&theme=dark`
