import { z } from 'zod'

export const AUDIT_ENTITY_TYPES = [
  'ORDER',
  'PRODUCT',
  'CATEGORY',
  'INVENTORY',
  'USER_ACCOUNT',
] as const

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]

const AuditFieldChangeSchema = z.object({
  before: z.unknown().optional(),
  after: z.unknown().optional(),
})

const AuditLogItemPropsSchema = z.object({
  entityKey: z.string(),
  occurredAtAuditId: z.string(),
  auditId: z.string(),
  entityType: z.enum(AUDIT_ENTITY_TYPES),
  entityId: z.string(),
  sourceTable: z.string().optional(),
  eventName: z.string(),
  occurredAt: z.string(),
  actorType: z.string(),
  actorId: z.string().optional(),
  actorEmail: z.string().optional(),
  reason: z.string().optional(),
  diff: z.record(z.string(), AuditFieldChangeSchema),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  keys: z.record(z.string(), z.unknown()).optional(),
  schemaVersion: z.number(),
  expiresAt: z.number(),
})

type AuditFieldChange = { before?: unknown; after?: unknown }

type AuditLogItemProps = z.infer<typeof AuditLogItemPropsSchema>

export class AuditLogItem {
  readonly entityKey!: string
  readonly occurredAtAuditId!: string
  readonly auditId!: string
  readonly entityType!: AuditEntityType
  readonly entityId!: string
  readonly sourceTable?: string
  readonly eventName!: string
  readonly occurredAt!: string
  readonly actorType!: string
  readonly actorId?: string
  readonly actorEmail?: string
  readonly reason?: string
  readonly diff!: Record<string, AuditFieldChange>
  readonly before!: Record<string, unknown>
  readonly after!: Record<string, unknown>
  readonly keys?: Record<string, unknown>
  readonly schemaVersion!: number
  readonly expiresAt!: number

  private constructor(props: AuditLogItemProps) {
    Object.assign(this, props)
  }

  static create(data: AuditLogItemProps): AuditLogItem {
    return new AuditLogItem(data)
  }

  static fromRecord(item: Record<string, unknown>): AuditLogItem {
    return new AuditLogItem(AuditLogItemPropsSchema.parse(item))
  }
}

export class AuditLogQueryResult {
  readonly items!: AuditLogItem[]
  readonly nextCursor!: string | null

  private constructor(props: { items: AuditLogItem[]; nextCursor: string | null }) {
    Object.assign(this, props)
  }

  static fromParts(items: AuditLogItem[], nextCursor: string | null): AuditLogQueryResult {
    return new AuditLogQueryResult({ items, nextCursor })
  }
}
