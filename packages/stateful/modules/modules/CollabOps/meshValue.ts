import {
  ChainMeshServices,
  MeshDescriptorV1,
  buildDefaultMeshDescriptor,
  mergeMeshLayers,
  parseMeshDescriptor,
  serializeMeshDescriptor,
} from '@dao-dao/utils'

import { CollabOpsModuleData } from './types'

/**
 * Build mesh.v1 storage value for CollabOps enable/edit (read-merge-write safe).
 * Only writes embeds.buzz / embeds.hermes + optional advanced meshJson merge.
 * Does not invent relays.
 */
export const buildCollabOpsMeshStorageValue = ({
  chainServices,
  data,
  existingMeshJson,
}: {
  chainServices: ChainMeshServices
  data: CollabOpsModuleData
  existingMeshJson?: string | null
}): string => {
  const embeds = {
    buzz: data.buzzEmbedBaseUrl?.trim() || undefined,
    hermes:
      data.hermesEmbedBaseUrl?.trim() ||
      data.hermesDeepLinkUrl?.trim() ||
      undefined,
  }
  const hasEmbeds = !!(embeds.buzz || embeds.hermes)

  const patch: Partial<MeshDescriptorV1> = {
    ...(hasEmbeds ? { embeds } : {}),
    ...(data.privateVisibility
      ? {
          eventDefaults: {
            hermesVisibility: data.privateVisibility,
          },
        }
      : {}),
  }

  const candidates = [
    data.meshJson?.trim(),
    existingMeshJson?.trim(),
  ].filter(Boolean) as string[]

  for (const raw of candidates) {
    try {
      const parsed = parseMeshDescriptor(raw)
      return serializeMeshDescriptor(mergeMeshLayers(parsed, patch))
    } catch {
      /* try next */
    }
  }

  return serializeMeshDescriptor(
    buildDefaultMeshDescriptor(chainServices, {
      embeds: hasEmbeds ? embeds : undefined,
      eventDefaults: data.privateVisibility
        ? { hermesVisibility: data.privateVisibility }
        : undefined,
    })
  )
}
