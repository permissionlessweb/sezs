import { ADAPTERS } from "./pay"
import { Rail } from "./auth/types"

/** Catalog derived from adapters. live matches instruct. */
export const RAILS = ADAPTERS.map((a) => ({ id: a.id as Rail, ...a.quote() }))
