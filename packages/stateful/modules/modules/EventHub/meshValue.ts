import {
  ChainMeshServices,
  MeshDescriptorV1,
  MeshEventDefaultsV1,
  buildDefaultMeshDescriptor,
  mergeMeshLayers,
  parseMeshDescriptor,
  serializeMeshDescriptor,
} from '@dao-dao/utils'

import { EventHubModuleData } from './types'

/**
 * Build mesh.v1 storage value for Event Hub enable/edit (read-merge-write safe).
 *
 * Preference:
 * 1. Valid module meshJson (advanced) merged with Event Hub owned fields
 * 2. Chain defaults + Event Hub fields
 *
 * Preserves marketplace / auth / unknown sibling keys when meshJson is valid.
 */
export const buildEventHubMeshStorageValue = ({
  chainServices,
  data,
  existingMeshJson,
}: {
  chainServices: ChainMeshServices
  data: EventHubModuleData
  /** Existing DAO storage mesh.v1 when known (preserve siblings). */
  existingMeshJson?: string | null
}): string => {
  const calendar =
    data.calendarContract?.trim() || undefined
  const ceremony =
    data.ceremonyContract?.trim() || undefined

  const embeds = {
    bounties: data.bountiesEmbedBaseUrl?.trim() || undefined,
    buzz: data.buzzEmbedBaseUrl?.trim() || undefined,
    hermes: data.hermesEmbedBaseUrl?.trim() || undefined,
  }
  const hasEmbeds = !!(embeds.bounties || embeds.buzz || embeds.hermes)

  const eventDefaults: MeshEventDefaultsV1 | undefined = (() => {
    const ed: MeshEventDefaultsV1 = {
      requireRegistration: data.registrationPolicy === 'ceremony',
      buzzGate: data.buzzGate,
      hermesVisibility: data.hermesVisibility,
      bountyView:
        data.bountiesDefaultView === 'public' ? 'public' : 'event',
    }
    if (
      ed.requireRegistration === undefined &&
      !ed.buzzGate &&
      !ed.hermesVisibility &&
      !ed.bountyView
    ) {
      return undefined
    }
    // Always set requireRegistration boolean when registration policy is set.
    if (data.registrationPolicy === 'ceremony') {
      ed.requireRegistration = true
    } else if (data.registrationPolicy) {
      ed.requireRegistration = false
    }
    return ed
  })()

  const patch: Partial<MeshDescriptorV1> = {
    ...(calendar ? { calendar } : {}),
    ...(ceremony ? { ceremony } : {}),
    ...(hasEmbeds ? { embeds } : {}),
    ...(eventDefaults ? { eventDefaults } : {}),
  }

  // Prefer advanced module meshJson, else existing DAO storage, else chain default.
  const candidates = [
    data.meshJson?.trim(),
    existingMeshJson?.trim(),
  ].filter(Boolean) as string[]

  for (const raw of candidates) {
    try {
      const parsed = parseMeshDescriptor(raw)
      const merged = mergeMeshLayers(parsed, patch)
      // Prefer module calendar/ceremony when provided
      const mesh: MeshDescriptorV1 = {
        ...merged,
        calendar: calendar || merged.calendar,
        ceremony: ceremony || merged.ceremony,
      }
      return serializeMeshDescriptor(mesh)
    } catch {
      // try next candidate
    }
  }

  return serializeMeshDescriptor(
    buildDefaultMeshDescriptor(chainServices, {
      calendar,
      ceremony,
      embeds: hasEmbeds ? embeds : undefined,
      eventDefaults,
    })
  )
}
