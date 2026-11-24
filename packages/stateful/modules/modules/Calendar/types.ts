export type CalendarModuleData = {
  /**
   * dao-calendar contract address for this DAO (or shared calendar instance).
   */
  calendarContract: string
  /**
   * Optional markdown intro shown above the calendar.
   */
  description: string
  /**
   * When true (default), FE resolveMesh uses chain headstash defaults for
   * query/relays if the DAO has not published mesh.v1 yet.
   */
  useChainMeshDefault?: boolean
  /**
   * Optional inline mesh.v1 JSON (advanced). Prefer DAO storage item mesh.v1;
   * this is a module-level override for discovery before storage is written.
   */
  meshJson?: string
}
