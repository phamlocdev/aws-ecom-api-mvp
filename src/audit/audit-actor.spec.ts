import { Role } from '../auth/roles.enum'
import { AuthenticatedUser } from '../auth/auth.types'
import {
  buildUserAuditMutationContext,
  systemAuditMutationContext,
  toAuditMutationAttributes,
  toAuditMutationExpressionValues,
} from './audit-actor'

function makeUser(groups: Role[]): AuthenticatedUser {
  return {
    sub: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    groups,
    permissions: [],
    tokenUse: 'access',
    clientId: 'client',
  }
}

describe('buildUserAuditMutationContext', () => {
  it('returns actorType "admin" for admin users', () => {
    const ctx = buildUserAuditMutationContext(makeUser([Role.ADMIN]), 'Category created')

    expect(ctx.actorType).toBe('admin')
    expect(ctx.actorId).toBe('user-1')
    expect(ctx.actorEmail).toBe('test@example.com')
    expect(ctx.reason).toBe('Category created')
  })

  it('returns actorType "admin" for manager users', () => {
    const ctx = buildUserAuditMutationContext(makeUser([Role.MANAGER]), 'Product updated')

    expect(ctx.actorType).toBe('admin')
  })

  it('returns actorType "customer" for customer users', () => {
    const ctx = buildUserAuditMutationContext(makeUser([Role.CUSTOMER]), 'Cart updated')

    expect(ctx.actorType).toBe('customer')
  })

  it('returns actorType "customer" for users with no groups', () => {
    const ctx = buildUserAuditMutationContext(makeUser([]), 'Order placed')

    expect(ctx.actorType).toBe('customer')
  })
})

describe('systemAuditMutationContext', () => {
  it('returns a system actor with no email', () => {
    const ctx = systemAuditMutationContext('worker-service', 'Order expired')

    expect(ctx.actorType).toBe('system')
    expect(ctx.actorId).toBe('worker-service')
    expect(ctx.actorEmail).toBeUndefined()
    expect(ctx.reason).toBe('Order expired')
  })
})

describe('toAuditMutationAttributes', () => {
  it('maps actor fields to flat object attributes', () => {
    const ctx = buildUserAuditMutationContext(makeUser([Role.ADMIN]), 'Deleted')

    const attrs = toAuditMutationAttributes(ctx)

    expect(attrs).toEqual({
      lastModifiedByType: 'admin',
      lastModifiedById: 'user-1',
      lastModifiedByEmail: 'test@example.com',
      lastModifiedReason: 'Deleted',
    })
  })

  it('uses "unknown" for missing actorId and actorEmail', () => {
    const attrs = toAuditMutationAttributes({
      actorType: 'system',
      reason: 'Automated',
    })

    expect(attrs.lastModifiedById).toBe('unknown')
    expect(attrs.lastModifiedByEmail).toBe('unknown')
  })
})

describe('toAuditMutationExpressionValues', () => {
  it('returns expression value keys with colon prefix', () => {
    const ctx = buildUserAuditMutationContext(makeUser([Role.CUSTOMER]), 'Profile updated')

    const values = toAuditMutationExpressionValues(ctx)

    expect(values).toMatchObject({
      ':lastModifiedByType': 'customer',
      ':lastModifiedById': 'user-1',
      ':lastModifiedByEmail': 'test@example.com',
      ':lastModifiedReason': 'Profile updated',
    })
  })
})
