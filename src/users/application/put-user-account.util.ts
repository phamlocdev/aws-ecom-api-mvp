import { AuditMutationContext, toAuditMutationAttributes } from '../../audit/audit-actor'
import { normalizePermissions } from '../../auth/permissions'
import { UserAccount, UserPasswordStatus } from '../domain/user.entity'
import { UserAccountRepositoryPort } from '../domain/user-account.repository.port'
import { resolvePasswordStatus } from '../domain/user.rules'

export type PutUserAccountInput = Pick<UserAccount, 'userId'> &
  Partial<
    Pick<UserAccount, 'username' | 'email' | 'name' | 'permissions' | 'status' | 'address'>
  > & {
    passwordStatus?: UserPasswordStatus
    avatarKey?: string | null
    auditActor?: AuditMutationContext
  }

// Shared by every managed-user/own-profile use-case that mutates the stored
// UserAccount record. Read-modify-write, matching the pre-refactor
// UsersService.putUserAccount() behavior exactly (including that it is not
// atomic/transactional).
export async function putUserAccount(
  userAccountRepository: UserAccountRepositoryPort,
  input: PutUserAccountInput,
): Promise<UserAccount> {
  const existing = await userAccountRepository.findById(input.userId)
  const timestamp = new Date().toISOString()
  const record: UserAccount = {
    userId: input.userId,
    username: input.username ?? existing?.username ?? input.userId,
    ...(input.email !== undefined
      ? { email: input.email }
      : existing?.email
        ? { email: existing.email }
        : {}),
    ...(input.name !== undefined
      ? { name: input.name }
      : existing?.name
        ? { name: existing.name }
        : {}),
    ...(input.avatarKey === null
      ? {}
      : input.avatarKey !== undefined
        ? { avatarKey: input.avatarKey }
        : existing?.avatarKey
          ? { avatarKey: existing.avatarKey }
          : {}),
    ...(input.address !== undefined
      ? { address: input.address }
      : existing?.address
        ? { address: existing.address }
        : {}),
    permissions: normalizePermissions(input.permissions ?? existing?.permissions),
    status: input.status ?? existing?.status ?? 'ACTIVE',
    passwordStatus:
      input.passwordStatus ??
      existing?.passwordStatus ??
      resolvePasswordStatus(existing, input.username ?? existing?.username ?? input.userId),
    ...(existing?.lastLoginAt ? { lastLoginAt: existing.lastLoginAt } : {}),
    ...(existing?.lastLoginIp ? { lastLoginIp: existing.lastLoginIp } : {}),
    ...(existing?.lastLoginUserAgent ? { lastLoginUserAgent: existing.lastLoginUserAgent } : {}),
    ...(existing?.loginCount !== undefined ? { loginCount: existing.loginCount } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    ...(input.auditActor
      ? toAuditMutationAttributes(input.auditActor)
      : existing?.lastModifiedByType
        ? {
            lastModifiedByType: existing.lastModifiedByType,
            lastModifiedById: existing.lastModifiedById,
            lastModifiedByEmail: existing.lastModifiedByEmail,
            lastModifiedReason: existing.lastModifiedReason,
          }
        : {}),
  }

  await userAccountRepository.save(record)

  return record
}
