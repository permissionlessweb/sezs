import {
  ChainMeshServices,
  curateMeshCalendarRecord,
} from '@dao-dao/utils'

/**
 * Build the mesh.v1 storage item value written when enabling/editing Calendar.
 * Uses the shared daoNipRecords curator (same socket as Marketplace enable).
 *
 * Preference order (inside curator):
 * 1. Valid module `meshJson` (advanced) with calendar filled from module if missing
 * 2. Chain headstash defaults + calendarContract
 */
export const buildCalendarMeshStorageValue = ({
  chainServices,
  calendarContract,
  meshJson,
}: {
  chainServices: ChainMeshServices
  calendarContract: string
  meshJson?: string | null
}): string =>
  curateMeshCalendarRecord({
    chainServices,
    calendar: calendarContract.trim() || undefined,
    meshJson,
  })
