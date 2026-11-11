import { ConflictError, InvalidInputError, NotFoundError } from '../../common/domain-error'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Role } from '../../auth/roles.enum'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { SesMailService } from '../../mail/ses-mail.service'
import { UploadService } from '../../upload/upload.service'
import { CognitoUserPort, CognitoUserRecord } from '../domain/cognito-user.port'
import { UserAccount } from '../domain/user.entity'
import { UserAccountRepositoryPort } from '../domain/user-account.repository.port'
import { CreateManagedUserUseCase } from './create-managed-user.use-case'
import { FindAllUsersUseCase } from './find-all-users.use-case'
import { FindCustomerProfileByUsernameUseCase } from './find-customer-profile-by-username.use-case'
import { FindLoginAuditUseCase } from './find-login-audit.use-case'
import { GetOwnProfileUseCase } from './get-own-profile.use-case'
import { GetWelcomeEmailTrackingUseCase } from './get-welcome-email-tracking.use-case'
import { RecordLoginContextUseCase } from './record-login-context.use-case'
import { ResendFailedWelcomeEmailUseCase } from './resend-failed-welcome-email.use-case'
import { ResetManagedUserPasswordUseCase } from './reset-managed-user-password.use-case'
import { SetOwnPasswordUseCase } from './set-own-password.use-case'
import { UpdateManagedUserUseCase } from './update-managed-user.use-case'
import { UpdateOwnProfileUseCase } from './update-own-profile.use-case'
import { UpdateUserPermissionsUseCase } from './update-user-permissions.use-case'

// Unit tests for the users use-cases (Giai đoạn 3): exercised against mocked
// CognitoUserPort/UserAccountRepositoryPort, no AWS SDK involved. See
// docs/refactor/PLAN.md. External module services (EmailTrackingService,
// SesMailService, UploadService) are injected directly (same pattern as
// orders use-cases injecting ReserveInventoryUseCase), so they are mocked with
// plain jest.fn() objects here too.

const actor: AuthenticatedUser = {
  sub: 'admin-1',
  username: 'admin',
  email: 'admin@example.com',
  groups: [Role.ADMIN],
  permissions: [],
  tokenUse: 'access',
  clientId: 'test-client',
}

const customer: AuthenticatedUser = {
  sub: 'customer-1',
  username: 'customer',
  email: 'customer@example.com',
  name: 'Customer One',
  groups: [Role.CUSTOMER],
  permissions: [],
  tokenUse: 'access',
  clientId: 'test-client',
}

const cognitoRecord: CognitoUserRecord = {
  username: 'customer',
  enabled: true,
  status: 'CONFIRMED',
  attributes: {
    sub: 'customer-1',
    email: 'customer@example.com',
    email_verified: 'true',
    name: 'Customer One',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const storedAccount = UserAccount.fromRecord({
  userId: 'customer-1',
  username: 'customer',
  email: 'customer@example.com',
  name: 'Customer One',
  permissions: [],
  status: 'ACTIVE',
  passwordStatus: 'SET',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function createCognitoPortMock(): jest.Mocked<CognitoUserPort> {
  return {
    listAllUsers: jest.fn().mockResolvedValue([cognitoRecord]),
    getUserGroups: jest.fn().mockResolvedValue([Role.CUSTOMER]),
    getUserByUsername: jest.fn().mockResolvedValue(cognitoRecord),
    createUser: jest.fn(),
    addUserToGroup: jest.fn(),
    updateUserAttributes: jest.fn(),
    enableUser: jest.fn(),
    disableUser: jest.fn(),
    setUserPassword: jest.fn(),
    findUserByEmail: jest.fn(),
  }
}

function createUserAccountRepositoryMock(): jest.Mocked<UserAccountRepositoryPort> {
  return {
    findById: jest.fn().mockResolvedValue(storedAccount),
    save: jest.fn().mockResolvedValue(undefined),
    updateLoginContext: jest.fn().mockResolvedValue(undefined),
    recordAuthenticationLogin: jest.fn().mockResolvedValue(undefined),
    insertLoginAudit: jest.fn().mockResolvedValue(undefined),
    findLatestLoginAudit: jest.fn().mockResolvedValue(undefined),
    updateLoginAuditContext: jest.fn().mockResolvedValue(undefined),
    queryLoginAudit: jest.fn().mockResolvedValue({ items: [] }),
  }
}

function createEmailTrackingServiceMock() {
  return {
    getLatestSummary: jest.fn().mockResolvedValue(undefined),
    findByContext: jest.fn().mockResolvedValue([]),
    findLatestRetryableForRecipient: jest.fn().mockResolvedValue(undefined),
    getStatistics: jest.fn(),
  } as unknown as jest.Mocked<EmailTrackingService>
}

describe('FindAllUsersUseCase', () => {
  it('enriches every Cognito user with groups, stored account and welcome-email tracking', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    emailTrackingService.getLatestSummary.mockResolvedValue({
      recipientEmail: 'customer@example.com',
      emailType: 'WELCOME_NEW_CUSTOMER',
      status: 'SENT',
      updatedAt: '2026-01-01T00:00:00.000Z',
      emailId: 'email-1',
      isRetryable: false,
      attemptNumber: 1,
    })
    const useCase = new FindAllUsersUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    const result = await useCase.execute()

    expect(result).toHaveLength(1)
    expect(result[0].groups).toEqual([Role.CUSTOMER])
    expect(result[0].accountStatus).toBe('ACTIVE')
    expect(result[0].welcomeEmailTracking?.status).toBe('SENT')
    expect(userAccountRepository.findById).toHaveBeenCalledWith('customer-1')
  })
})

describe('CreateManagedUserUseCase', () => {
  it('propagates ConflictError when the username already exists', async () => {
    const cognitoUserPort = createCognitoPortMock()
    cognitoUserPort.createUser.mockRejectedValue(new ConflictError('User already exists.'))
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new CreateManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await expect(
      useCase.execute(actor, {
        username: 'customer',
        email: 'customer@example.com',
        password: 'Passw0rd!',
        group: Role.CUSTOMER,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(cognitoUserPort.addUserToGroup).not.toHaveBeenCalled()
  })

  it('creates the Cognito user, adds it to the group and persists the stored account', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    userAccountRepository.findById.mockResolvedValue(null)
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new CreateManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    const result = await useCase.execute(actor, {
      username: 'customer',
      email: 'customer@example.com',
      password: 'Passw0rd!',
      group: Role.CUSTOMER,
    })

    expect(cognitoUserPort.createUser).toHaveBeenCalledWith({
      username: 'customer',
      email: 'customer@example.com',
      name: undefined,
      temporaryPassword: 'Passw0rd!',
    })
    expect(cognitoUserPort.addUserToGroup).toHaveBeenCalledWith('customer', Role.CUSTOMER)
    expect(userAccountRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'customer-1', passwordStatus: 'SET' }),
    )
    expect(result.username).toBe('customer')
  })
})

describe('UpdateManagedUserUseCase / DisableManagedUserUseCase', () => {
  it('updates email attributes and persists the stored account', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new UpdateManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await useCase.execute(actor, 'customer-1', { email: 'new@example.com' })

    expect(cognitoUserPort.updateUserAttributes).toHaveBeenCalledWith('customer', {
      email: 'new@example.com',
      email_verified: 'true',
    })
    expect(userAccountRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.com' }),
    )
  })

  it('disables user in Cognito and suspends account when enabled becomes false', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new UpdateManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await useCase.execute(actor, 'customer-1', { enabled: false })

    expect(cognitoUserPort.disableUser).toHaveBeenCalledWith('customer')
    expect(userAccountRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUSPENDED' }),
    )
  })

  it('throws NotFoundError when the managed user does not exist', async () => {
    const cognitoUserPort = createCognitoPortMock()
    cognitoUserPort.listAllUsers.mockResolvedValue([])
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new UpdateManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await expect(useCase.execute(actor, 'missing', { name: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('UpdateUserPermissionsUseCase', () => {
  it('normalizes and persists the updated permission list', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new UpdateUserPermissionsUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    const result = await useCase.execute('customer-1', ['products:read'] as never, actor)

    expect(userAccountRepository.save).toHaveBeenCalled()
    expect(result.userId).toBe('customer-1')
  })
})

describe('ResetManagedUserPasswordUseCase', () => {
  it('sets a temporary (non-permanent) password', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new ResetManagedUserPasswordUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await useCase.execute('customer-1', 'Temporary@123')

    expect(cognitoUserPort.setUserPassword).toHaveBeenCalledWith('customer', 'Temporary@123', false)
  })
})

describe('SetOwnPasswordUseCase', () => {
  it('throws InvalidInputError when the email is not verified', async () => {
    const cognitoUserPort = createCognitoPortMock()
    cognitoUserPort.getUserByUsername.mockResolvedValue({
      ...cognitoRecord,
      attributes: { ...cognitoRecord.attributes, email_verified: 'false' },
    })
    const userAccountRepository = createUserAccountRepositoryMock()
    const useCase = new SetOwnPasswordUseCase(cognitoUserPort, userAccountRepository)

    await expect(useCase.execute(customer, 'NewPassw0rd!')).rejects.toBeInstanceOf(
      InvalidInputError,
    )
    expect(cognitoUserPort.setUserPassword).not.toHaveBeenCalled()
  })

  it('sets a permanent password and persists SET status when verified', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const useCase = new SetOwnPasswordUseCase(cognitoUserPort, userAccountRepository)

    await useCase.execute(customer, 'NewPassw0rd!')

    expect(cognitoUserPort.setUserPassword).toHaveBeenCalledWith('customer', 'NewPassw0rd!', true)
    expect(userAccountRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordStatus: 'SET' }),
    )
  })
})

describe('GetWelcomeEmailTrackingUseCase', () => {
  it('checks the user exists before returning tracking attempts', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new GetWelcomeEmailTrackingUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await useCase.execute('customer-1')

    expect(emailTrackingService.findByContext).toHaveBeenCalledWith('USER', 'customer-1', [
      'WELCOME_NEW_CUSTOMER',
    ])
  })
})

describe('ResendFailedWelcomeEmailUseCase', () => {
  it('returns SKIPPED when there is no retryable tracking item', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const sesMailService = {
      sendWelcomeNewCustomerEmail: jest.fn(),
    } as unknown as jest.Mocked<SesMailService>
    const useCase = new ResendFailedWelcomeEmailUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
      sesMailService,
    )

    const result = await useCase.execute('customer-1', 'customer@example.com')

    expect(result).toMatchObject({
      status: 'SKIPPED',
      reason: 'no-retryable-recipients',
      resentCount: 0,
    })
    expect(sesMailService.sendWelcomeNewCustomerEmail).not.toHaveBeenCalled()
  })
})

describe('RecordLoginContextUseCase', () => {
  it('records the login context and updates the latest audit row when present', async () => {
    const userAccountRepository = createUserAccountRepositoryMock()
    userAccountRepository.findLatestLoginAudit.mockResolvedValue({
      userId: customer.sub,
      loginAt: '2026-01-01T00:00:00.000Z',
      loginId: 'login-1',
      userPoolId: 'pool-1',
      triggerSource: 'UserMigration_Authentication',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: 0,
    })
    const useCase = new RecordLoginContextUseCase(userAccountRepository)

    await useCase.execute(customer, { ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(userAccountRepository.updateLoginContext).toHaveBeenCalledWith(
      customer.sub,
      expect.objectContaining({ lastLoginIp: '127.0.0.1', lastLoginUserAgent: 'jest' }),
    )
    expect(userAccountRepository.updateLoginAuditContext).toHaveBeenCalledWith(
      customer.sub,
      '2026-01-01T00:00:00.000Z',
      expect.objectContaining({ ipAddress: '127.0.0.1', userAgent: 'jest' }),
    )
  })

  it('does not touch the audit row when no latest audit exists', async () => {
    const userAccountRepository = createUserAccountRepositoryMock()
    const useCase = new RecordLoginContextUseCase(userAccountRepository)

    await useCase.execute(customer, { ipAddress: '127.0.0.1' })

    expect(userAccountRepository.updateLoginAuditContext).not.toHaveBeenCalled()
  })
})

describe('FindLoginAuditUseCase', () => {
  it('throws InvalidInputError when no filter is provided', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new FindLoginAuditUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await expect(useCase.execute({})).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('throws InvalidInputError when more than one filter is provided', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new FindLoginAuditUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    await expect(
      useCase.execute({ userId: 'customer-1', username: 'customer' }),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('queries by userId directly and encodes the next cursor', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const userAccountRepository = createUserAccountRepositoryMock()
    userAccountRepository.queryLoginAudit.mockResolvedValue({
      items: [],
      lastEvaluatedKey: { userId: 'customer-1', loginAt: '2026-01-01T00:00:00.000Z' },
    })
    const emailTrackingService = createEmailTrackingServiceMock()
    const useCase = new FindLoginAuditUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService,
    )

    const result = await useCase.execute({ userId: 'customer-1' })

    expect(userAccountRepository.queryLoginAudit).toHaveBeenCalledWith('customer-1', 25, undefined)
    expect(result.nextCursor).not.toBeNull()
  })
})

describe('FindCustomerProfileByUsernameUseCase', () => {
  it('maps the Cognito record to a customer profile', async () => {
    const cognitoUserPort = createCognitoPortMock()
    const useCase = new FindCustomerProfileByUsernameUseCase(cognitoUserPort)

    const result = await useCase.execute('customer')

    expect(result).toEqual({
      username: 'customer',
      email: 'customer@example.com',
      name: 'Customer One',
      sub: 'customer-1',
    })
  })
})

describe('GetOwnProfileUseCase / UpdateOwnProfileUseCase', () => {
  it('merges the stored account into the authenticated user profile', async () => {
    const userAccountRepository = createUserAccountRepositoryMock()
    const uploadService = {
      isAvatarKeyForUser: jest.fn(),
      verifyObjectsExist: jest.fn(),
      createReadUrls: jest.fn(),
      deleteObjectsBestEffort: jest.fn(),
    } as unknown as jest.Mocked<UploadService>
    const cognitoUserPort = createCognitoPortMock()
    const useCase = new GetOwnProfileUseCase(
      userAccountRepository,
      uploadService,
      cognitoUserPort,
    )

    const result = await useCase.execute(customer)

    expect(result.userId).toBe(customer.sub)
    expect(result.email).toBe(storedAccount.email)
  })

  it('throws InvalidInputError when avatarKey does not belong to the authenticated user', async () => {
    const userAccountRepository = createUserAccountRepositoryMock()
    const uploadService = {
      isAvatarKeyForUser: jest.fn().mockReturnValue(false),
      verifyObjectsExist: jest.fn(),
      createReadUrls: jest.fn(),
      deleteObjectsBestEffort: jest.fn(),
    } as unknown as jest.Mocked<UploadService>
    const cognitoUserPort = createCognitoPortMock()
    const useCase = new UpdateOwnProfileUseCase(
      userAccountRepository,
      uploadService,
      cognitoUserPort,
    )

    await expect(
      useCase.execute(customer, { avatarKey: 'users/someone-else/avatar/x.webp' }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(uploadService.verifyObjectsExist).not.toHaveBeenCalled()
  })
})
