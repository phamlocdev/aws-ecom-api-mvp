import { NotFoundError } from '../../common/domain-error'
import { normalizePermissions } from '../../auth/permissions'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { CognitoUserPort, CognitoUserRecord } from '../domain/cognito-user.port'
import { ManagedUser } from '../domain/user.entity'
import { UserAccountRepositoryPort } from '../domain/user-account.repository.port'
import { resolvePasswordStatus } from '../domain/user.rules'

// Shared by every managed-user use-case: enrich a raw Cognito user record
// with Cognito groups + the stored UserAccount + welcome-email tracking,
// matching the pre-refactor UsersService.toManagedUser() behavior exactly.
export async function toManagedUser(
  cognitoUserPort: CognitoUserPort,
  userAccountRepository: UserAccountRepositoryPort,
  emailTrackingService: EmailTrackingService,
  record: CognitoUserRecord,
): Promise<ManagedUser> {
  const groups = await cognitoUserPort.getUserGroups(record.username)

  const managedUser: ManagedUser = {
    username: record.username,
    enabled: record.enabled,
    status: record.status,
    name: record.attributes.name,
    sub: record.attributes.sub,
    email: record.attributes.email,
    emailVerified: record.attributes.email_verified === 'true',
    groups,
    permissions: [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }

  if (managedUser.sub) {
    const account = await userAccountRepository.findById(managedUser.sub)
    managedUser.permissions = normalizePermissions(account?.permissions)
    managedUser.accountStatus = account?.status
    managedUser.passwordStatus = resolvePasswordStatus(account, managedUser.username)
    managedUser.welcomeEmailTracking = await emailTrackingService.getLatestSummary(
      'USER',
      managedUser.sub,
      'WELCOME_NEW_CUSTOMER',
    )
  }

  return managedUser
}

export async function findAllManagedUsers(
  cognitoUserPort: CognitoUserPort,
  userAccountRepository: UserAccountRepositoryPort,
  emailTrackingService: EmailTrackingService,
): Promise<ManagedUser[]> {
  const records = await cognitoUserPort.listAllUsers()
  return Promise.all(
    records.map((record) =>
      toManagedUser(cognitoUserPort, userAccountRepository, emailTrackingService, record),
    ),
  )
}

export async function findManagedUserByUsername(
  cognitoUserPort: CognitoUserPort,
  userAccountRepository: UserAccountRepositoryPort,
  emailTrackingService: EmailTrackingService,
  username: string,
): Promise<ManagedUser> {
  const record = await cognitoUserPort.getUserByUsername(username)
  return toManagedUser(cognitoUserPort, userAccountRepository, emailTrackingService, record)
}

export async function findManagedUserBySub(
  cognitoUserPort: CognitoUserPort,
  userAccountRepository: UserAccountRepositoryPort,
  emailTrackingService: EmailTrackingService,
  userId: string,
): Promise<ManagedUser> {
  const users = await findAllManagedUsers(
    cognitoUserPort,
    userAccountRepository,
    emailTrackingService,
  )
  const user = users.find((item) => item.sub === userId)
  if (!user) {
    throw new NotFoundError(`User ${userId} was not found.`)
  }
  return user
}
