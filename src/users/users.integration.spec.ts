import { mockClient } from 'aws-sdk-client-mock'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { ConfigService } from '@nestjs/config'
import { ConflictError, InvalidInputError, NotFoundError } from '../common/domain-error'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { AuthenticatedUser } from '../auth/auth.types'
import { Role } from '../auth/roles.enum'
import { EmailTrackingService } from '../mail/email-tracking.service'
import { SesMailService } from '../mail/ses-mail.service'
import { UploadService } from '../upload/upload.service'
import { CognitoUserRepository } from './infrastructure/cognito-user.repository'
import { DynamoDbUserAccountRepository } from './infrastructure/dynamodb-user-account.repository'
import { CognitoUserPort } from './domain/cognito-user.port'
import { UserAccountRepositoryPort } from './domain/user-account.repository.port'
import { CreateManagedUserUseCase } from './application/create-managed-user.use-case'
import { FindAllUsersUseCase } from './application/find-all-users.use-case'
import { DisableManagedUserUseCase } from './application/disable-managed-user.use-case'
import { UpdateManagedUserUseCase } from './application/update-managed-user.use-case'
import { ResetManagedUserPasswordUseCase } from './application/reset-managed-user-password.use-case'
import { SetOwnPasswordUseCase } from './application/set-own-password.use-case'
import { FindLoginAuditUseCase } from './application/find-login-audit.use-case'
import { RecordLoginContextUseCase } from './application/record-login-context.use-case'
import { FindCustomerProfileByUsernameUseCase } from './application/find-customer-profile-by-username.use-case'
import { ResendFailedWelcomeEmailUseCase } from './application/resend-failed-welcome-email.use-case'
import { GetOwnProfileUseCase } from './application/get-own-profile.use-case'
import { UpdateOwnProfileUseCase } from './application/update-own-profile.use-case'

// Giai đoạn 3 baseline for `users` (see docs/refactor/PLAN.md): the
// pre-refactor UsersService was deleted in the same session it was split
// (strangler pattern, same as `products`/`carts`), so this integration test
// is written directly against the post-refactor use-cases + the real
// CognitoUserRepository/DynamoDbUserAccountRepository (AWS SDK calls
// intercepted by aws-sdk-client-mock) to lock down the Cognito/DynamoDB
// contract and business behavior described in docs/refactor/PROGRESS.md.
describe('users use-cases (integration)', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient)
  const cognitoMock = mockClient(CognitoIdentityProviderClient)

  let cognitoUserPort: CognitoUserPort
  let userAccountRepository: UserAccountRepositoryPort
  let emailTrackingService: jest.Mocked<
    Pick<
      EmailTrackingService,
      'getLatestSummary' | 'findByContext' | 'findLatestRetryableForRecipient' | 'getStatistics'
    >
  >
  let sesMailService: jest.Mocked<Pick<SesMailService, 'sendWelcomeNewCustomerEmail'>>
  let uploadService: jest.Mocked<
    Pick<
      UploadService,
      'isAvatarKeyForUser' | 'verifyObjectsExist' | 'createReadUrls' | 'deleteObjectsBestEffort'
    >
  >

  let findAllUsersUseCase: FindAllUsersUseCase
  let createManagedUserUseCase: CreateManagedUserUseCase
  let disableManagedUserUseCase: DisableManagedUserUseCase
  let updateManagedUserUseCase: UpdateManagedUserUseCase
  let resetManagedUserPasswordUseCase: ResetManagedUserPasswordUseCase
  let setOwnPasswordUseCase: SetOwnPasswordUseCase
  let findLoginAuditUseCase: FindLoginAuditUseCase
  let recordLoginContextUseCase: RecordLoginContextUseCase
  let findCustomerProfileByUsernameUseCase: FindCustomerProfileByUsernameUseCase
  let getOwnProfileUseCase: GetOwnProfileUseCase
  let updateOwnProfileUseCase: UpdateOwnProfileUseCase
  let resendFailedWelcomeEmailUseCase: ResendFailedWelcomeEmailUseCase

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

  function cognitoUserOf(sub: string, username: string, emailVerified = 'true') {
    return {
      Username: username,
      Enabled: true,
      UserStatus: 'CONFIRMED' as const,
      UserCreateDate: new Date('2026-01-01T00:00:00.000Z'),
      UserLastModifiedDate: new Date('2026-01-01T00:00:00.000Z'),
      Attributes: [
        { Name: 'sub', Value: sub },
        { Name: 'email', Value: `${username}@example.com` },
        { Name: 'email_verified', Value: emailVerified },
        { Name: 'name', Value: username },
      ],
    }
  }

  // AdminGetUserCommand's response shape differs from ListUsersCommand's
  // UserType (UserAttributes instead of Attributes).
  function adminGetUserResponseOf(sub: string, username: string, emailVerified = 'true') {
    const record = cognitoUserOf(sub, username, emailVerified)
    return {
      Username: record.Username,
      Enabled: record.Enabled,
      UserStatus: record.UserStatus,
      UserCreateDate: record.UserCreateDate,
      UserLastModifiedDate: record.UserLastModifiedDate,
      UserAttributes: record.Attributes,
    }
  }

  beforeEach(() => {
    ddbMock.reset()
    cognitoMock.reset()

    const dynamoDbService = {
      documentClient: ddbMock as unknown as DynamoDBDocumentClient,
    } as unknown as DynamoDbService

    const dynamoTables = {
      userAccounts: 'user-accounts-test',
      userLoginAudit: 'user-login-audit-test',
    } as unknown as DynamoTablesService

    const configService = {
      get: jest.fn((key: string) => (key === 'COGNITO_USER_POOL_ID' ? 'pool-test' : undefined)),
    } as unknown as ConfigService

    cognitoUserPort = new CognitoUserRepository(configService)
    userAccountRepository = new DynamoDbUserAccountRepository(dynamoDbService, dynamoTables)

    emailTrackingService = {
      getLatestSummary: jest.fn().mockResolvedValue(undefined),
      findByContext: jest.fn().mockResolvedValue([]),
      findLatestRetryableForRecipient: jest.fn().mockResolvedValue(undefined),
      getStatistics: jest.fn(),
    }
    sesMailService = {
      sendWelcomeNewCustomerEmail: jest.fn().mockResolvedValue({ status: 'SENT' }),
    }
    uploadService = {
      isAvatarKeyForUser: jest.fn(),
      verifyObjectsExist: jest.fn().mockResolvedValue(undefined),
      createReadUrls: jest
        .fn()
        .mockResolvedValue([{ key: 'k', readUrl: 'https://example.com/k', expiresInSeconds: 900 }]),
      deleteObjectsBestEffort: jest.fn().mockResolvedValue(undefined),
    }

    findAllUsersUseCase = new FindAllUsersUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService as unknown as EmailTrackingService,
    )
    createManagedUserUseCase = new CreateManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService as unknown as EmailTrackingService,
    )
    disableManagedUserUseCase = new DisableManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService as unknown as EmailTrackingService,
    )
    updateManagedUserUseCase = new UpdateManagedUserUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService as unknown as EmailTrackingService,
      disableManagedUserUseCase,
    )
    resetManagedUserPasswordUseCase = new ResetManagedUserPasswordUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService as unknown as EmailTrackingService,
    )
    setOwnPasswordUseCase = new SetOwnPasswordUseCase(cognitoUserPort, userAccountRepository)
    findLoginAuditUseCase = new FindLoginAuditUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService as unknown as EmailTrackingService,
    )
    recordLoginContextUseCase = new RecordLoginContextUseCase(userAccountRepository)
    findCustomerProfileByUsernameUseCase = new FindCustomerProfileByUsernameUseCase(cognitoUserPort)
    resendFailedWelcomeEmailUseCase = new ResendFailedWelcomeEmailUseCase(
      cognitoUserPort,
      userAccountRepository,
      emailTrackingService as unknown as EmailTrackingService,
      sesMailService as unknown as SesMailService,
    )
    getOwnProfileUseCase = new GetOwnProfileUseCase(
      userAccountRepository,
      uploadService as unknown as UploadService,
      findCustomerProfileByUsernameUseCase,
    )
    updateOwnProfileUseCase = new UpdateOwnProfileUseCase(
      userAccountRepository,
      uploadService as unknown as UploadService,
      findCustomerProfileByUsernameUseCase,
    )
  })

  describe('FindAllUsersUseCase', () => {
    it('enriches every Cognito user with groups, stored account and welcome-email tracking', async () => {
      cognitoMock
        .on(ListUsersCommand)
        .resolves({ Users: [cognitoUserOf('customer-1', 'customer')] })
      cognitoMock
        .on(AdminListGroupsForUserCommand)
        .resolves({ Groups: [{ GroupName: Role.CUSTOMER }] })
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'customer-1',
          username: 'customer',
          permissions: ['products:read'],
          status: 'ACTIVE',
          passwordStatus: 'SET',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })

      const result = await findAllUsersUseCase.execute()

      expect(result).toHaveLength(1)
      expect(result[0].groups).toEqual([Role.CUSTOMER])
      expect(result[0].permissions).toEqual(['products:read'])
    })
  })

  describe('CreateManagedUserUseCase', () => {
    it('throws ConflictError when the username already exists', async () => {
      cognitoMock
        .on(AdminCreateUserCommand)
        .rejects(Object.assign(new Error('username exists'), { name: 'UsernameExistsException' }))

      await expect(
        createManagedUserUseCase.execute(actor, {
          username: 'customer',
          email: 'customer@example.com',
          password: 'Passw0rd!',
          group: Role.CUSTOMER,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('creates the user, adds it to the group and stores the account', async () => {
      cognitoMock.on(AdminCreateUserCommand).resolves({})
      cognitoMock.on(AdminGetUserCommand).resolves(adminGetUserResponseOf('customer-1', 'customer'))
      cognitoMock
        .on(AdminListGroupsForUserCommand)
        .resolves({ Groups: [{ GroupName: Role.CUSTOMER }] })
      ddbMock.on(GetCommand).resolves({ Item: undefined })
      ddbMock.on(PutCommand).resolves({})

      const result = await createManagedUserUseCase.execute(actor, {
        username: 'customer',
        email: 'customer@example.com',
        password: 'Passw0rd!',
        group: Role.CUSTOMER,
      })

      expect(result.username).toBe('customer')
      const addToGroupCalls = cognitoMock.commandCalls(AdminAddUserToGroupCommand)
      expect(addToGroupCalls).toHaveLength(1)
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1)
    })
  })

  describe('UpdateManagedUserUseCase', () => {
    it('disables the account and persists SUSPENDED status when enabled becomes false', async () => {
      cognitoMock
        .on(ListUsersCommand)
        .resolves({ Users: [cognitoUserOf('customer-1', 'customer')] })
      cognitoMock.on(AdminListGroupsForUserCommand).resolves({ Groups: [] })
      cognitoMock.on(AdminDisableUserCommand).resolves({})
      ddbMock.on(GetCommand).resolves({ Item: undefined })
      ddbMock.on(PutCommand).resolves({})

      await updateManagedUserUseCase.execute(actor, 'customer-1', { enabled: false })

      expect(cognitoMock.commandCalls(AdminDisableUserCommand)).toHaveLength(1)
      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls[putCalls.length - 1].args[0].input.Item).toMatchObject({
        status: 'SUSPENDED',
      })
    })

    it('throws NotFoundError when the managed user does not exist', async () => {
      cognitoMock.on(ListUsersCommand).resolves({ Users: [] })

      await expect(
        updateManagedUserUseCase.execute(actor, 'missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('ResetManagedUserPasswordUseCase', () => {
    it('sets a non-permanent temporary password', async () => {
      cognitoMock
        .on(ListUsersCommand)
        .resolves({ Users: [cognitoUserOf('customer-1', 'customer')] })
      cognitoMock.on(AdminListGroupsForUserCommand).resolves({ Groups: [] })
      ddbMock.on(GetCommand).resolves({ Item: undefined })
      cognitoMock.on(AdminSetUserPasswordCommand).resolves({})

      await resetManagedUserPasswordUseCase.execute('customer-1', 'Temporary@123')

      const calls = cognitoMock.commandCalls(AdminSetUserPasswordCommand)
      expect(calls).toHaveLength(1)
      expect(calls[0].args[0].input.Permanent).toBe(false)
    })
  })

  describe('ResendFailedWelcomeEmailUseCase', () => {
    it('resends the welcome email to the retryable recipient', async () => {
      cognitoMock
        .on(ListUsersCommand)
        .resolves({ Users: [cognitoUserOf('customer-1', 'customer')] })
      cognitoMock.on(AdminListGroupsForUserCommand).resolves({ Groups: [] })
      ddbMock.on(GetCommand).resolves({ Item: undefined })
      emailTrackingService.findLatestRetryableForRecipient.mockResolvedValue({
        emailId: 'email-1',
        emailType: 'WELCOME_NEW_CUSTOMER',
        recipientEmail: 'customer@example.com',
        status: 'FAILED',
        contextType: 'USER',
        contextId: 'customer-1',
        contextKey: 'USER#customer-1',
        attemptNumber: 1,
        isRetryable: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      const result = await resendFailedWelcomeEmailUseCase.execute(
        'customer-1',
        'customer@example.com',
      )

      expect(result.status).toBe('SENT')
      expect(result.resentCount).toBe(1)
      expect(sesMailService.sendWelcomeNewCustomerEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmails: ['customer@example.com'],
          resendOfByRecipient: { 'customer@example.com': 'email-1' },
        }),
      )
    })
  })

  describe('SetOwnPasswordUseCase', () => {
    it('throws InvalidInputError when the email is not verified', async () => {
      cognitoMock.on(AdminGetUserCommand).resolves({
        Username: 'customer',
        UserAttributes: [{ Name: 'email_verified', Value: 'false' }],
      })

      await expect(setOwnPasswordUseCase.execute(customer, 'NewPassw0rd!')).rejects.toBeInstanceOf(
        InvalidInputError,
      )
    })

    it('sets a permanent password when the email is verified', async () => {
      cognitoMock.on(AdminGetUserCommand).resolves({
        Username: 'customer',
        UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
      })
      cognitoMock.on(AdminSetUserPasswordCommand).resolves({})
      ddbMock.on(GetCommand).resolves({ Item: undefined })
      ddbMock.on(PutCommand).resolves({})

      await setOwnPasswordUseCase.execute(customer, 'NewPassw0rd!')

      const calls = cognitoMock.commandCalls(AdminSetUserPasswordCommand)
      expect(calls[0].args[0].input.Permanent).toBe(true)
    })
  })

  describe('FindLoginAuditUseCase', () => {
    it('throws InvalidInputError when 0 filters are provided', async () => {
      await expect(findLoginAuditUseCase.execute({})).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('throws InvalidInputError when more than 1 filter is provided', async () => {
      await expect(
        findLoginAuditUseCase.execute({ userId: 'customer-1', email: 'customer@example.com' }),
      ).rejects.toBeInstanceOf(InvalidInputError)
    })

    it('queries by userId directly', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      const result = await findLoginAuditUseCase.execute({ userId: 'customer-1' })

      expect(result.items).toEqual([])
      const calls = ddbMock.commandCalls(QueryCommand)
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':userId': 'customer-1',
      })
    })

    it('resolves the sub by email filter before querying', async () => {
      cognitoMock
        .on(ListUsersCommand)
        .resolves({ Users: [cognitoUserOf('customer-1', 'customer')] })
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      await findLoginAuditUseCase.execute({ email: 'customer@example.com' })

      const calls = ddbMock.commandCalls(QueryCommand)
      expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({
        ':userId': 'customer-1',
      })
    })
  })

  describe('RecordLoginContextUseCase', () => {
    it('records the login context in the user account row', async () => {
      ddbMock.on(UpdateCommand).resolves({})
      ddbMock.on(QueryCommand).resolves({ Items: [] })

      await recordLoginContextUseCase.execute(customer, {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      })

      const calls = ddbMock.commandCalls(UpdateCommand)
      expect(calls[0].args[0].input.TableName).toBe('user-accounts-test')
    })
  })

  describe('FindCustomerProfileByUsernameUseCase', () => {
    it('maps the Cognito profile', async () => {
      cognitoMock.on(AdminGetUserCommand).resolves({
        Username: 'customer',
        UserAttributes: [
          { Name: 'email', Value: 'customer@example.com' },
          { Name: 'name', Value: 'Customer One' },
          { Name: 'sub', Value: 'customer-1' },
        ],
      })

      const result = await findCustomerProfileByUsernameUseCase.execute('customer')

      expect(result).toEqual({
        username: 'customer',
        email: 'customer@example.com',
        name: 'Customer One',
        sub: 'customer-1',
      })
    })
  })

  describe('GetOwnProfileUseCase', () => {
    it('returns the merged profile for the authenticated user', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          userId: 'customer-1',
          username: 'customer',
          email: 'customer@example.com',
          name: 'Customer One',
          permissions: [],
          status: 'ACTIVE',
          passwordStatus: 'SET',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })

      const result = await getOwnProfileUseCase.execute(customer)

      expect(result.userId).toBe('customer-1')
      expect(result.email).toBe('customer@example.com')
    })
  })

  describe('UpdateOwnProfileUseCase', () => {
    it('throws InvalidInputError when avatarKey does not belong to the authenticated user', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })
      uploadService.isAvatarKeyForUser.mockReturnValue(false)

      await expect(
        updateOwnProfileUseCase.execute(customer, {
          avatarKey: 'users/someone-else/avatar/x.webp',
        }),
      ).rejects.toBeInstanceOf(InvalidInputError)
      expect(uploadService.verifyObjectsExist).not.toHaveBeenCalled()
    })

    it('updates the profile name and persists the stored account', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined })
      ddbMock.on(PutCommand).resolves({})

      const result = await updateOwnProfileUseCase.execute(customer, { name: 'New Name' })

      expect(result.name).toBe('New Name')
      const putCalls = ddbMock.commandCalls(PutCommand)
      expect(putCalls[putCalls.length - 1].args[0].input.Item).toMatchObject({ name: 'New Name' })
    })
  })
})
