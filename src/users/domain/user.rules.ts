import { InvalidInputError } from '../../common/domain-error'
import { AuthenticatedUser } from '../../auth/auth.types'
import { normalizePermissions } from '../../auth/permissions'
import {
  CustomerProfile,
  UserAccount,
  UserAddress,
  UserPasswordStatus,
  UserPermissionsRecord,
  UserProfile,
} from './user.entity'

// Pure business rules shared by several users use-cases. Kept in domain/
// because they only depend on the User entities, not on Nest/AWS SDK.

export function normalizeEmail(email: string | undefined): string | undefined {
  const normalizedEmail = email?.trim().toLowerCase()
  return normalizedEmail || undefined
}

/** Login-audit cursor codec. Deliberately simpler than src/pagination/* (no
 * resource/limit wrapper) because the pre-refactor code paginated this one
 * query by raw DynamoDB LastEvaluatedKey only. */
export function encodeCursor(value: Record<string, unknown> | undefined): string | null {
  if (!value) {
    return null
  }

  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeCursor(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }

  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new InvalidInputError('cursor is invalid.')
  }
}

export function mergeAuthenticatedUserProfile(
  user: AuthenticatedUser,
  storedProfile: UserAccount | null,
  cognitoProfile: CustomerProfile | null,
): AuthenticatedUser {
  return {
    ...user,
    email: user.email ?? storedProfile?.email ?? cognitoProfile?.email,
    name: user.name ?? storedProfile?.name ?? cognitoProfile?.name,
  }
}

export function toUserProfile(
  user: AuthenticatedUser,
  storedProfile: UserAccount | null,
): UserProfile {
  const timestamp = new Date().toISOString()

  return UserProfile.fromRecord({
    userId: user.sub,
    username: user.username,
    ...((user.email ?? storedProfile?.email) ? { email: user.email ?? storedProfile?.email } : {}),
    ...(storedProfile?.name ? { name: storedProfile.name } : user.name ? { name: user.name } : {}),
    ...(storedProfile?.avatarKey ? { avatarKey: storedProfile.avatarKey } : {}),
    ...(storedProfile?.address ? { address: storedProfile.address } : {}),
    passwordStatus: resolvePasswordStatus(storedProfile, user.username),
    createdAt: storedProfile?.createdAt ?? timestamp,
    updatedAt: storedProfile?.updatedAt ?? timestamp,
  } as unknown as Record<string, unknown>)
}

export function normalizeUserAddress(address: UserAddress): UserAddress {
  const location = {
    ...(address.location?.ward ? { ward: address.location.ward } : {}),
    ...(address.location?.district ? { district: address.location.district } : {}),
    ...(address.location?.city ? { city: address.location.city } : {}),
  }

  return UserAddress.create({
    ...(address.recipientName ? { recipientName: address.recipientName } : {}),
    ...(address.phone ? { phone: address.phone } : {}),
    ...(address.line1 ? { line1: address.line1 } : {}),
    ...(Object.keys(location).length > 0 ? { location } : {}),
    ...(address.notes ? { notes: address.notes } : {}),
  })
}

export function resolvePasswordStatus(
  account: Pick<UserAccount, 'passwordStatus'> | null | undefined,
  username: string | undefined,
): UserPasswordStatus {
  if (account?.passwordStatus) {
    return account.passwordStatus
  }

  return isGoogleFederatedUsername(username) ? 'REQUIRED' : 'SET'
}

export function isGoogleFederatedUsername(username: string | undefined): boolean {
  return Boolean(username?.toLowerCase().startsWith('google_'))
}

export function toUserPermissionsRecord(account: UserAccount): UserPermissionsRecord {
  return UserPermissionsRecord.fromRecord({
    userId: account.userId,
    permissions: normalizePermissions(account.permissions),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  } as unknown as Record<string, unknown>)
}
