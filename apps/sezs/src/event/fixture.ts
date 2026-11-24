import type { EventManifold } from './api'
import raw from './fixture.json'

/** Deterministic local event record. Same shape as a chain query. */
export const FIXTURE = raw as EventManifold
