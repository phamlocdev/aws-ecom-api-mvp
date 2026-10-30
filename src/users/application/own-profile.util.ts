import { Logger } from '@nestjs/common'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { UploadService } from '../../upload/upload.service'
import { CustomerProfile, UserAccount, UserProfile } from '../domain/user.entity'
import { UserAccountRepositoryPort } from '../domain/user-account.repository.port'
import { CognitoUserPort } from '../domain/cognito-user.port'
import { resolvePasswordStatus } from '../domain/user.rules'
import { putUserAccount } from './put-user-account.util'

const logger = new Logger('UsersService')

// Shared by GetOwnProfileUseCase/UpdateOwnProfileUseCase, matching the
// pre-refactor UsersService private helpers exactly.
export async function findCognitoProfileForAuthenticatedUser(
  cognitoUserPort: CognitoUserPort,
  user: AuthenticatedUser,
  account: UserAccount | null,
): Promise<CustomerProfile | null> {
  if (user.email && (user.name || account?.name)) {
    return null
  }

  try {
    const record = await cognitoUserPort.getUserByUsername(user.username)
    return {
      username: user.username,
      email: record.attributes.email,
      name: record.attributes.name,
      sub: record.attributes.sub,
    }
  } catch (error) {
    logger.warn(
      JSON.stringify({
        action: 'cognito-profile-lookup-failed',
        userId: user.sub,
        username: user.username,
        reason: error instanceof Error ? error.message : 'unknown-error',
      }),
    )
    return null
  }
}

export async function backfillStoredAccountProfile(
  userAccountRepository: UserAccountRepositoryPort,
  user: AuthenticatedUser,
  account: UserAccount | null,
): Promise<UserAccount | null> {
  if ((account?.email || !user.email) && (account?.name || !user.name)) {
    return account
  }

  return putUserAccount(userAccountRepository, {
    userId: user.sub,
    username: account?.username ?? user.username,
    email: account?.email ?? user.email,
    name: account?.name ?? user.name,
    avatarKey: account?.avatarKey,
    permissions: account?.permissions ?? [],
    status: account?.status,
    passwordStatus: resolvePasswordStatus(account, user.username),
    auditActor: systemAuditMutationContext('users-service', 'Stored account profile backfilled'),
  })
}

export async function withAvatarReadUrl(
  uploadService: UploadService,
  profile: UserProfile,
): Promise<UserProfile> {
  if (!profile.avatarKey) {
    return profile
  }

  const [readUrl] = await uploadService.createReadUrls([profile.avatarKey])
  return {
    ...profile,
    avatarReadUrl: readUrl.readUrl,
    avatarReadUrlExpiresInSeconds: readUrl.expiresInSeconds,
  }
}
