import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {
  AuditMutationContext,
  buildUserAuditMutationContext,
  systemAuditMutationContext,
  toAuditMutationAttributes,
} from '../audit/audit-actor'
import { normalizePermissions, Permission } from '../auth/permissions'
import { AuthenticatedUser } from '../auth/auth.types'
import { DynamoDbService } from '../dynamodb/dynamodb.service'
import { EmailTrackingService } from '../mail/email-tracking.service'
import { EmailDeliveryStatistics, EmailTrackingView } from '../mail/mail.types'
import { SesMailService } from '../mail/ses-mail.service'
import { UploadService } from '../upload/upload.service'
import { CreateManagedUserDto } from './dto/create-managed-user.dto'
import { UpdateManagedUserDto } from './dto/update-managed-user.dto'
import { UpdateUserProfileDto } from './dto/update-user-profile.dto'
import {
  CustomerProfile,
  ManagedUser,
  ResendUserEmailResult,
  UserAccount,
  UserLoginAudit,
  UserLoginAuditQueryResult,
  UserPermissionsRecord,
  UserPasswordStatus,
  UserProfile,
} from './user.types'

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)
  private readonly userPoolId: string
  private readonly userAccountsTableName: string
  private readonly userLoginAuditTableName: string
  private readonly cognitoClient: CognitoIdentityProviderClient

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
    @Inject(SesMailService)
    private readonly sesMailService: SesMailService,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
  ) {
    this.userPoolId = configService.get<string>('COGNITO_USER_POOL_ID') ?? ''
    this.userAccountsTableName = configService.get<string>('USER_ACCOUNTS_TABLE') ?? 'user-accounts'
    this.userLoginAuditTableName =
      configService.get<string>('USER_LOGIN_AUDIT_TABLE') ?? 'user-login-audit'

    const region =
      configService.get<string>('AWS_REGION') ??
      configService.get<string>('AWS_DEFAULT_REGION') ??
      'ap-southeast-1'
    this.cognitoClient = new CognitoIdentityProviderClient({
      region,
    })
  }

  async findAll(): Promise<ManagedUser[]> {
    const users: UserType[] = []
    let paginationToken: string | undefined

    do {
      const response = await this.cognitoClient.send(
        new ListUsersCommand({
          UserPoolId: this.userPoolId,
          PaginationToken: paginationToken,
          Limit: 60,
        }),
      )

      users.push(...(response.Users ?? []))
      paginationToken = response.PaginationToken
    } while (paginationToken)

    return Promise.all(users.map((user) => this.toManagedUser(user)))
  }

  async createManagedUser(
    actor: AuthenticatedUser,
    dto: CreateManagedUserDto,
  ): Promise<ManagedUser> {
    const attributes: AttributeType[] = [
      { Name: 'email', Value: dto.email },
      { Name: 'email_verified', Value: 'true' },
    ]
    if (dto.name) {
      attributes.push({ Name: 'name', Value: dto.name })
    }

    try {
      await this.cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: dto.username,
          TemporaryPassword: dto.password,
          UserAttributes: attributes,
        }),
      )
    } catch (error) {
      if (isCognitoError(error, 'UsernameExistsException')) {
        throw new ConflictException(`User ${dto.username} already exists.`)
      }
      throw error
    }

    await this.cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: this.userPoolId,
        Username: dto.username,
        GroupName: dto.group,
      }),
    )

    const user = await this.findManagedUserByUsername(dto.username)
    if (user.sub) {
      await this.putUserAccount({
        userId: user.sub,
        username: user.username,
        email: user.email,
        name: user.name,
        permissions: normalizePermissions(dto.permissions),
        passwordStatus: 'SET',
        auditActor: buildUserAuditMutationContext(actor, 'Managed user created'),
      })
    }

    return this.findManagedUserByUsername(dto.username)
  }

  async updateManagedUser(
    actor: AuthenticatedUser,
    userId: string,
    dto: UpdateManagedUserDto,
  ): Promise<ManagedUser> {
    const user = await this.findManagedUserBySub(userId)

    const userAttributes: AttributeType[] = []
    if (dto.email !== undefined) {
      userAttributes.push({ Name: 'email', Value: dto.email })
      userAttributes.push({ Name: 'email_verified', Value: 'true' })
    }
    if (dto.name !== undefined) {
      userAttributes.push({ Name: 'name', Value: dto.name })
    }

    if (userAttributes.length > 0) {
      await this.cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: user.username,
          UserAttributes: userAttributes,
        }),
      )

      await this.putUserAccount({
        userId,
        username: user.username,
        email: dto.email ?? user.email,
        name: dto.name ?? user.name,
        permissions: user.permissions,
        auditActor: buildUserAuditMutationContext(actor, 'Managed user profile updated'),
      })
    }

    if (dto.status !== undefined) {
      await this.putUserAccount({
        userId,
        username: user.username,
        email: dto.email ?? user.email,
        name: dto.name ?? user.name,
        permissions: user.permissions,
        status: dto.status,
        auditActor: buildUserAuditMutationContext(actor, 'Managed user status updated'),
      })
    }

    if (dto.enabled === true && !user.enabled) {
      await this.cognitoClient.send(
        new AdminEnableUserCommand({
          UserPoolId: this.userPoolId,
          Username: user.username,
        }),
      )
    } else if (dto.enabled === false && user.enabled) {
      await this.disableManagedUser(userId, actor)
    }

    return this.findManagedUserBySub(userId)
  }

  async disableManagedUser(userId: string, actor?: AuthenticatedUser): Promise<void> {
    const user = await this.findManagedUserBySub(userId)
    await this.cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: this.userPoolId,
        Username: user.username,
      }),
    )
    await this.putUserAccount({
      userId,
      username: user.username,
      email: user.email,
      name: user.name,
      permissions: user.permissions,
      status: 'SUSPENDED',
      auditActor: actor
        ? buildUserAuditMutationContext(actor, 'Managed user disabled')
        : systemAuditMutationContext('users-service', 'Managed user disabled'),
    })
  }

  async updateUserPermissions(
    userId: string,
    permissions: Permission[],
    actor: AuthenticatedUser,
  ): Promise<UserPermissionsRecord> {
    await this.findManagedUserBySub(userId)
    const record = await this.putUserAccount({
      userId,
      permissions: normalizePermissions(permissions),
      auditActor: buildUserAuditMutationContext(actor, 'Managed user permissions updated'),
    })

    return toUserPermissionsRecord(record)
  }

  async resetManagedUserPassword(userId: string, password: string): Promise<void> {
    const user = await this.findManagedUserBySub(userId)

    await this.cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: user.username,
        Password: password,
        Permanent: false,
      }),
    )
  }

  async setOwnPassword(user: AuthenticatedUser, password: string): Promise<void> {
    const response = await this.cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: user.username,
      }),
    )
    const attributes = toAttributeMap(response.UserAttributes ?? [])

    if (attributes.email_verified !== 'true') {
      throw new BadRequestException('Your email must be verified before setting a password.')
    }

    await this.cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: user.username,
        Password: password,
        Permanent: true,
      }),
    )

    await this.putUserAccount({
      userId: user.sub,
      username: user.username,
      email: user.email,
      name: user.name,
      passwordStatus: 'SET',
      auditActor: buildUserAuditMutationContext(user, 'Own password set'),
    })
  }

  async getWelcomeEmailStatistics(): Promise<EmailDeliveryStatistics> {
    return this.emailTrackingService.getStatistics(['WELCOME_NEW_CUSTOMER'])
  }

  async getWelcomeEmailTracking(userId: string): Promise<EmailTrackingView[]> {
    await this.findManagedUserBySub(userId)
    return this.emailTrackingService.findByContext('USER', userId, ['WELCOME_NEW_CUSTOMER'])
  }

  async resendFailedWelcomeEmail(
    userId: string,
    recipientEmail: string,
  ): Promise<ResendUserEmailResult> {
    const user = await this.findManagedUserBySub(userId)
    const normalizedRecipientEmail = normalizeEmail(recipientEmail)
    if (!normalizedRecipientEmail) {
      throw new BadRequestException('recipientEmail is required.')
    }

    const retryableItem = await this.emailTrackingService.findLatestRetryableForRecipient({
      contextType: 'USER',
      contextId: userId,
      emailType: 'WELCOME_NEW_CUSTOMER',
      recipientEmail: normalizedRecipientEmail,
    })

    if (!retryableItem) {
      return {
        userId,
        emailType: 'WELCOME_NEW_CUSTOMER',
        recipientEmails: [],
        resentCount: 0,
        status: 'SKIPPED',
        reason: 'no-retryable-recipients',
      }
    }

    const recipientEmails = [normalizedRecipientEmail]
    const result = await this.sesMailService.sendWelcomeNewCustomerEmail({
      user,
      recipientEmails,
      resendOfByRecipient: {
        [normalizedRecipientEmail]: retryableItem.emailId,
      },
    })

    return {
      userId,
      emailType: 'WELCOME_NEW_CUSTOMER',
      recipientEmails,
      resentCount: recipientEmails.length,
      status: result.status,
      reason: result.reason,
    }
  }

  async recordLoginContext(
    user: AuthenticatedUser,
    input: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const updatedAt = new Date().toISOString()
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
    }
    const expressionAttributeValues: Record<string, unknown> = {
      ':updatedAt': updatedAt,
    }
    const setExpressions = ['#updatedAt = :updatedAt']

    if (input.ipAddress) {
      expressionAttributeNames['#lastLoginIp'] = 'lastLoginIp'
      expressionAttributeValues[':lastLoginIp'] = input.ipAddress
      setExpressions.push('#lastLoginIp = :lastLoginIp')
    }

    if (input.userAgent) {
      expressionAttributeNames['#lastLoginUserAgent'] = 'lastLoginUserAgent'
      expressionAttributeValues[':lastLoginUserAgent'] = input.userAgent
      setExpressions.push('#lastLoginUserAgent = :lastLoginUserAgent')
    }

    await this.dynamoDbService.documentClient.send(
      new UpdateCommand({
        TableName: this.userAccountsTableName,
        Key: { userId: user.sub },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }),
    )

    const latestAudit = await this.findLatestLoginAudit(user.sub)
    if (latestAudit && (input.ipAddress || input.userAgent)) {
      const auditNames: Record<string, string> = { '#updatedAt': 'updatedAt' }
      const auditValues: Record<string, unknown> = { ':updatedAt': updatedAt }
      const auditSetExpressions = ['#updatedAt = :updatedAt']

      if (input.ipAddress) {
        auditNames['#ipAddress'] = 'ipAddress'
        auditValues[':ipAddress'] = input.ipAddress
        auditSetExpressions.push('#ipAddress = :ipAddress')
      }

      if (input.userAgent) {
        auditNames['#userAgent'] = 'userAgent'
        auditValues[':userAgent'] = input.userAgent
        auditSetExpressions.push('#userAgent = :userAgent')
      }

      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.userLoginAuditTableName,
          Key: { userId: user.sub, loginAt: latestAudit.loginAt },
          UpdateExpression: `SET ${auditSetExpressions.join(', ')}`,
          ExpressionAttributeNames: auditNames,
          ExpressionAttributeValues: auditValues,
        }),
      )
    }

    this.logger.log(
      JSON.stringify({
        action: 'login-context-recorded',
        userId: user.sub,
        username: user.username,
        hasIpAddress: Boolean(input.ipAddress),
        hasUserAgent: Boolean(input.userAgent),
        auditUpdated: Boolean(latestAudit),
      }),
    )
  }

  async findLoginAudit(input: {
    userId?: string
    username?: string
    email?: string
    limit?: number
    cursor?: string
  }): Promise<UserLoginAuditQueryResult> {
    const userId = await this.resolveLoginAuditUserId(input)
    const requestedLimit = Number.isFinite(input.limit) ? input.limit : 25
    const limit = Math.min(Math.max(requestedLimit ?? 25, 1), 100)
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.userLoginAuditTableName,
        KeyConditionExpression: '#userId = :userId',
        ExpressionAttributeNames: {
          '#userId': 'userId',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(input.cursor),
      }),
    )

    return {
      items: (response.Items ?? []) as UserLoginAudit[],
      nextCursor: encodeCursor(response.LastEvaluatedKey as Record<string, unknown> | undefined),
    }
  }

  private async toManagedUser(user: UserType): Promise<ManagedUser> {
    const groupsResponse = await this.cognitoClient.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: this.userPoolId,
        Username: user.Username ?? '',
      }),
    )

    const attributes = toAttributeMap(user.Attributes ?? [])

    const managedUser: ManagedUser = {
      username: user.Username ?? '',
      enabled: user.Enabled ?? false,
      status: user.UserStatus,
      name: attributes.name,
      sub: attributes.sub,
      email: attributes.email,
      emailVerified: attributes.email_verified === 'true',
      groups: (groupsResponse.Groups ?? []).flatMap((group) =>
        group.GroupName ? [group.GroupName] : [],
      ),
      permissions: [],
      createdAt: user.UserCreateDate?.toISOString(),
      updatedAt: user.UserLastModifiedDate?.toISOString(),
    }

    if (managedUser.sub) {
      const account = await this.findStoredAccount(managedUser.sub)
      managedUser.permissions = normalizePermissions(account?.permissions)
      managedUser.accountStatus = account?.status
      managedUser.passwordStatus = resolvePasswordStatus(account, managedUser.username)
      managedUser.welcomeEmailTracking = await this.emailTrackingService.getLatestSummary(
        'USER',
        managedUser.sub,
        'WELCOME_NEW_CUSTOMER',
      )
    }

    return managedUser
  }

  private async findManagedUserByUsername(username: string): Promise<ManagedUser> {
    const response = await this.cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    )

    const user: UserType = {
      Username: response.Username,
      Enabled: response.Enabled,
      UserStatus: response.UserStatus,
      UserCreateDate: response.UserCreateDate,
      UserLastModifiedDate: response.UserLastModifiedDate,
      Attributes: response.UserAttributes,
    }
    return this.toManagedUser(user)
  }

  private async findManagedUserBySub(userId: string): Promise<ManagedUser> {
    const users = await this.findAll()
    const user = users.find((item) => item.sub === userId)
    if (!user) {
      throw new NotFoundException(`User ${userId} was not found.`)
    }
    return user
  }

  private async findUserPermissions(userId: string): Promise<Permission[]> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.userAccountsTableName,
        Key: { userId },
      }),
    )

    const record = response.Item as UserAccount | undefined
    return normalizePermissions(record?.permissions)
  }

  private async putUserAccount(
    input: Pick<UserAccount, 'userId'> &
      Partial<Pick<UserAccount, 'username' | 'email' | 'name' | 'permissions' | 'status'>> & {
        passwordStatus?: UserPasswordStatus
        avatarKey?: string | null
        auditActor?: AuditMutationContext
      },
  ): Promise<UserAccount> {
    const existingResponse = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.userAccountsTableName,
        Key: { userId: input.userId },
      }),
    )
    const existing = existingResponse.Item as UserAccount | undefined
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

    await this.dynamoDbService.documentClient.send(
      new PutCommand({
        TableName: this.userAccountsTableName,
        Item: record,
      }),
    )

    return record
  }

  async findCustomerProfileByUsername(username: string): Promise<CustomerProfile> {
    const response = await this.cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    )

    const attributes = toAttributeMap(response.UserAttributes ?? [])
    return {
      username,
      email: attributes.email,
      name: attributes.name,
      sub: attributes.sub,
    }
  }

  async getOwnProfile(user: AuthenticatedUser): Promise<UserProfile> {
    const account = await this.findStoredAccount(user.sub)
    const cognitoProfile = await this.findCognitoProfileForAuthenticatedUser(user, account)
    const profileUser = mergeAuthenticatedUserProfile(user, account, cognitoProfile)
    const storedAccount = await this.backfillStoredAccountProfile(profileUser, account)

    return this.withAvatarReadUrl(toUserProfile(profileUser, storedAccount))
  }

  async updateOwnProfile(user: AuthenticatedUser, dto: UpdateUserProfileDto): Promise<UserProfile> {
    const account = await this.findStoredAccount(user.sub)
    const cognitoProfile = await this.findCognitoProfileForAuthenticatedUser(user, account)
    const profileUser = mergeAuthenticatedUserProfile(user, account, cognitoProfile)
    const previousAvatarKey = account?.avatarKey

    if (typeof dto.avatarKey === 'string') {
      if (!this.uploadService.isAvatarKeyForUser(dto.avatarKey, user.sub)) {
        throw new BadRequestException('avatarKey must belong to the authenticated user.')
      }

      await this.uploadService.verifyObjectsExist([dto.avatarKey])
    }

    const nextAvatarKey = dto.avatarKey === null ? null : (dto.avatarKey ?? account?.avatarKey)
    const nextAccount = await this.putUserAccount({
      userId: user.sub,
      username: user.username,
      email: profileUser.email,
      name: dto.name !== undefined ? dto.name : (account?.name ?? profileUser.name),
      avatarKey: nextAvatarKey,
      permissions: account?.permissions ?? [],
      auditActor: buildUserAuditMutationContext(user, 'Own profile updated'),
    })

    if (previousAvatarKey && previousAvatarKey !== nextAvatarKey) {
      await this.uploadService.deleteObjectsBestEffort([previousAvatarKey])
    }

    return this.withAvatarReadUrl(toUserProfile(profileUser, nextAccount))
  }

  private async findStoredAccount(userId: string): Promise<UserAccount | null> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.userAccountsTableName,
        Key: { userId },
      }),
    )

    return (response.Item as UserAccount | undefined) ?? null
  }

  private async findCognitoProfileForAuthenticatedUser(
    user: AuthenticatedUser,
    account: UserAccount | null,
  ): Promise<CustomerProfile | null> {
    if (user.email && (user.name || account?.name)) {
      return null
    }

    try {
      return await this.findCustomerProfileByUsername(user.username)
    } catch (error) {
      this.logger.warn(
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

  private async backfillStoredAccountProfile(
    user: AuthenticatedUser,
    account: UserAccount | null,
  ): Promise<UserAccount | null> {
    if ((account?.email || !user.email) && (account?.name || !user.name)) {
      return account
    }

    return this.putUserAccount({
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

  private async findLatestLoginAudit(userId: string): Promise<UserLoginAudit | undefined> {
    const response = await this.dynamoDbService.documentClient.send(
      new QueryCommand({
        TableName: this.userLoginAuditTableName,
        KeyConditionExpression: '#userId = :userId',
        ExpressionAttributeNames: {
          '#userId': 'userId',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    )

    return response.Items?.[0] as UserLoginAudit | undefined
  }

  private async resolveLoginAuditUserId(input: {
    userId?: string
    username?: string
    email?: string
  }): Promise<string> {
    const filters = [input.userId, input.username, input.email].filter(Boolean)
    if (filters.length !== 1) {
      throw new BadRequestException('Provide exactly one of userId, username, or email.')
    }

    if (input.userId) {
      return input.userId
    }

    if (input.username) {
      const user = await this.findManagedUserByUsername(input.username)
      if (!user.sub) {
        throw new NotFoundException(`User ${input.username} does not have a sub attribute.`)
      }
      return user.sub
    }

    const email = normalizeEmail(input.email)
    if (!email) {
      throw new BadRequestException('email must be a valid non-empty value.')
    }

    const response = await this.cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: this.userPoolId,
        Filter: `email = "${escapeCognitoFilterValue(email)}"`,
        Limit: 1,
      }),
    )
    const user = response.Users?.[0]
    const attributes = toAttributeMap(user?.Attributes ?? [])
    if (!user || !attributes.sub) {
      throw new NotFoundException(`User with email ${email} was not found.`)
    }

    return attributes.sub
  }

  private async withAvatarReadUrl(profile: UserProfile): Promise<UserProfile> {
    if (!profile.avatarKey) {
      return profile
    }

    const [readUrl] = await this.uploadService.createReadUrls([profile.avatarKey])
    return {
      ...profile,
      avatarReadUrl: readUrl.readUrl,
      avatarReadUrlExpiresInSeconds: readUrl.expiresInSeconds,
    }
  }
}

function isCognitoError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === name
}

function toAttributeMap(attributes: AttributeType[]): Record<string, string> {
  return attributes.reduce<Record<string, string>>((result, attribute) => {
    if (attribute.Name && attribute.Value) {
      result[attribute.Name] = attribute.Value
    }
    return result
  }, {})
}

function normalizeEmail(email: string | undefined): string | undefined {
  const normalizedEmail = email?.trim().toLowerCase()
  return normalizedEmail || undefined
}

function encodeCursor(value: Record<string, unknown> | undefined): string | null {
  if (!value) {
    return null
  }

  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }

  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new BadRequestException('cursor is invalid.')
  }
}

function escapeCognitoFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function mergeAuthenticatedUserProfile(
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

function toUserProfile(user: AuthenticatedUser, storedProfile: UserAccount | null): UserProfile {
  const timestamp = new Date().toISOString()

  return {
    userId: user.sub,
    username: user.username,
    ...((user.email ?? storedProfile?.email) ? { email: user.email ?? storedProfile?.email } : {}),
    ...(storedProfile?.name ? { name: storedProfile.name } : user.name ? { name: user.name } : {}),
    ...(storedProfile?.avatarKey ? { avatarKey: storedProfile.avatarKey } : {}),
    passwordStatus: resolvePasswordStatus(storedProfile, user.username),
    createdAt: storedProfile?.createdAt ?? timestamp,
    updatedAt: storedProfile?.updatedAt ?? timestamp,
  }
}

function resolvePasswordStatus(
  account: Pick<UserAccount, 'passwordStatus'> | null | undefined,
  username: string | undefined,
): UserPasswordStatus {
  if (account?.passwordStatus) {
    return account.passwordStatus
  }

  return isGoogleFederatedUsername(username) ? 'REQUIRED' : 'SET'
}

function isGoogleFederatedUsername(username: string | undefined): boolean {
  return Boolean(username?.toLowerCase().startsWith('google_'))
}

function toUserPermissionsRecord(account: UserAccount): UserPermissionsRecord {
  return {
    userId: account.userId,
    permissions: normalizePermissions(account.permissions),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}
