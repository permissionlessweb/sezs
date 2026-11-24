/**
 * DAO-stored variables for the CollabOps module (Buzz public + Hermes private).
 *
 * Phase-1 (EN-F2 / t_8365ea2e): **info dashboard** from mesh.v1 + module overrides.
 * Live iframes are optional (`showLiveEmbeds`); identity planes stay separate.
 *
 * Public plane: Buzz collab endpoints (always visible).
 * Private plane: Hermes ops (member/admin gated — never forced into public view).
 *
 * Embed interop: docs/superpowers/specs/2026-07-21-dao-multi-surface-iframe-interop.md
 * Mesh policy: docs/superpowers/reviews/2026-08-06-text-record-mesh-endpoint-policy.md
 */

export type CollabOpsPlaneId = 'public' | 'private'

export type CollabOpsPrivateVisibility = 'only-members' | 'admins' | 'hidden'

export type CollabOpsModuleData = {
  /**
   * Optional markdown intro above the planes.
   */
  description: string
  /**
   * Buzz embed base. Empty → mesh.embeds.buzz / chain services.
   */
  buzzEmbedBaseUrl: string
  /**
   * Default Buzz child view when live embed is shown.
   */
  buzzDefaultView: 'public' | 'event'
  /**
   * When true, Buzz may request ADR-36 daoAttest (membership only).
   */
  enableDaoAttest: boolean
  /**
   * Hermes embed base. Empty → mesh.embeds.hermes / deep-link.
   */
  hermesEmbedBaseUrl: string
  /**
   * Hermes deep-link when iframe is not used.
   */
  hermesDeepLinkUrl: string
  /**
   * Product default: deep-link only (no blank iframe).
   */
  hermesDeepLinkOnly: boolean
  /**
   * Optional board slug for Hermes deep-link / embed query.
   */
  hermesBoardSlug: string
  /**
   * Who may see the private (Hermes) plane.
   * Never leaks private ops UI into the public plane.
   */
  privateVisibility: CollabOpsPrivateVisibility
  /**
   * Default plane when both are available.
   */
  defaultPlane: CollabOpsPlaneId
  /**
   * Resolve mesh.v1 (storage → module → text_record → chain default).
   * Default true. When false, only module/storage without inventing chain embeds.
   */
  useChainMeshDefault: boolean
  /**
   * Optional advanced mesh.v1 JSON (merge into enable write).
   */
  meshJson: string
  /**
   * When true, mount Buzz/Hermes embed slots under the info cards.
   * Phase-1 product default: false (info + external open only).
   */
  showLiveEmbeds: boolean
}
