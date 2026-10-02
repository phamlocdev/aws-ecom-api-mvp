import { AuthenticatedUser } from '../auth/auth.types'
import { Role } from '../auth/roles.enum'

export type AuditMutationActorType = 'customer' | 'admin' | 'system'

export interface AuditMutationContext {
  actorType: AuditMutationActorType
  actorId?: string
  actorEmail?: string
  reason: string
}

export const AUDIT_ACTOR_FIELDS =
  '#lastModifiedByType = :lastModifiedByType, #lastModifiedById = :lastModifiedById, #lastModifiedByEmail = :lastModifiedByEmail, #lastModifiedReason = :lastModifiedReason'

export const AUDIT_ACTOR_ATTRIBUTE_NAMES = {
  '#lastModifiedByType': 'lastModifiedByType',
  '#lastModifiedById': 'lastModifiedById',
  '#lastModifiedByEmail': 'lastModifiedByEmail',
  '#lastModifiedReason': 'lastModifiedReason',
}

export function buildUserAuditMutationContext(
  user: AuthenticatedUser,
  reason: string,
): AuditMutationContext {
  const actorType =
    user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER) ? 'admin' : 'customer'

  return {
    actorType,
    actorId: user.sub,
    actorEmail: user.email,
    reason,
  }
}

export function systemAuditMutationContext(actorId: string, reason: string): AuditMutationContext {
  return {
    actorType: 'system',
    actorId,
    reason,
  }
}

export function toAuditMutationAttributes(actor: AuditMutationContext) {
  return {
    lastModifiedByType: actor.actorType,
    lastModifiedById: actor.actorId ?? 'unknown',
    lastModifiedByEmail: actor.actorEmail ?? 'unknown',
    lastModifiedReason: actor.reason,
  }
}

export function toAuditMutationExpressionValues(
  actor: AuditMutationContext,
): Record<string, unknown> {
  return {
    ':lastModifiedByType': actor.actorType,
    ':lastModifiedById': actor.actorId ?? 'unknown',
    ':lastModifiedByEmail': actor.actorEmail ?? 'unknown',
    ':lastModifiedReason': actor.reason,
  }
}
