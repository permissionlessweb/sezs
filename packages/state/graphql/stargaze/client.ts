import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
} from '@apollo/client'

import { STARGAZE_GQL_INDEXER_URI, isValidUrl } from '@dao-dao/utils'

/**
 * Lab / non-Stargaze SDA: leave NEXT_PUBLIC_STARGAZE_GQL_INDEXER_URI empty so we
 * never hit mainnet Stargaze GQL (wrong chain + console/Sentry noise).
 */
export const isStargazeGqlIndexerConfigured = (): boolean =>
  typeof STARGAZE_GQL_INDEXER_URI === 'string' &&
  STARGAZE_GQL_INDEXER_URI.trim().length > 0 &&
  isValidUrl(STARGAZE_GQL_INDEXER_URI.trim())

/** No-op link: empty data, no network — soft-disable Stargaze GQL. */
const disabledStargazeLink = new ApolloLink(
  () =>
    new Observable((observer) => {
      observer.next({ data: {} })
      observer.complete()
    })
)

export const stargazeIndexerClient = isStargazeGqlIndexerConfigured()
  ? new ApolloClient({
      uri: STARGAZE_GQL_INDEXER_URI.trim(),
      cache: new InMemoryCache(),
    })
  : new ApolloClient({
      link: disabledStargazeLink,
      cache: new InMemoryCache(),
      defaultOptions: {
        query: { fetchPolicy: 'no-cache', errorPolicy: 'ignore' },
        watchQuery: { fetchPolicy: 'no-cache', errorPolicy: 'ignore' },
      },
    })
