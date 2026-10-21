import { Inject, Injectable } from '@nestjs/common'
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
import { ConflictError } from '../../common/domain-error'
import {
  CognitoUserPort,
  CognitoUserRecord,
  CreateCognitoUserInput,
} from '../domain/cognito-user.port'

// The only place in the `users` module allowed to construct
// CognitoIdentityProviderClient/send Cognito commands (see docs/refactor/PLAN.md).
@Injectable()
export class CognitoUserRepository implements CognitoUserPort {
  private readonly userPoolId: string
  private readonly cognitoClient: CognitoIdentityProviderClient

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.userPoolId = configService.get<string>('COGNITO_USER_POOL_ID') ?? ''

    const region =
      configService.get<string>('AWS_REGION') ??
      configService.get<string>('AWS_DEFAULT_REGION') ??
      'ap-southeast-1'
    this.cognitoClient = new CognitoIdentityProviderClient({ region })
  }

  async listAllUsers(): Promise<CognitoUserRecord[]> {
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

    return users.map((user) => toCognitoUserRecord(user))
  }

  async getUserGroups(username: string): Promise<string[]> {
    const response = await this.cognitoClient.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    )

    return (response.Groups ?? []).flatMap((group) => (group.GroupName ? [group.GroupName] : []))
  }

  async getUserByUsername(username: string): Promise<CognitoUserRecord> {
    const response = await this.cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    )

    return toCognitoUserRecord({
      Username: response.Username,
      Enabled: response.Enabled,
      UserStatus: response.UserStatus,
      UserCreateDate: response.UserCreateDate,
      UserLastModifiedDate: response.UserLastModifiedDate,
      Attributes: response.UserAttributes,
    })
  }

  async createUser(input: CreateCognitoUserInput): Promise<void> {
    const attributes: AttributeType[] = [
      { Name: 'email', Value: input.email },
      { Name: 'email_verified', Value: 'true' },
    ]
    if (input.name) {
      attributes.push({ Name: 'name', Value: input.name })
    }

    try {
      await this.cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: input.username,
          TemporaryPassword: input.temporaryPassword,
          UserAttributes: attributes,
        }),
      )
    } catch (error) {
      if (isCognitoError(error, 'UsernameExistsException')) {
        throw new ConflictError(`User ${input.username} already exists.`)
      }
      throw error
    }
  }

  async addUserToGroup(username: string, group: string): Promise<void> {
    await this.cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        GroupName: group,
      }),
    )
  }

  async updateUserAttributes(username: string, attributes: Record<string, string>): Promise<void> {
    await this.cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        UserAttributes: Object.entries(attributes).map(([Name, Value]) => ({ Name, Value })),
      }),
    )
  }

  async enableUser(username: string): Promise<void> {
    await this.cognitoClient.send(
      new AdminEnableUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    )
  }

  async disableUser(username: string): Promise<void> {
    await this.cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      }),
    )
  }

  async setUserPassword(username: string, password: string, permanent: boolean): Promise<void> {
    await this.cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        Password: password,
        Permanent: permanent,
      }),
    )
  }

  async findUserByEmail(email: string): Promise<CognitoUserRecord | null> {
    const response = await this.cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: this.userPoolId,
        Filter: `email = "${escapeCognitoFilterValue(email)}"`,
        Limit: 1,
      }),
    )
    const user = response.Users?.[0]
    return user ? toCognitoUserRecord(user) : null
  }
}

function toCognitoUserRecord(user: UserType): CognitoUserRecord {
  return {
    username: user.Username ?? '',
    enabled: user.Enabled ?? false,
    status: user.UserStatus,
    attributes: toAttributeMap(user.Attributes ?? []),
    createdAt: user.UserCreateDate?.toISOString(),
    updatedAt: user.UserLastModifiedDate?.toISOString(),
  }
}

function toAttributeMap(attributes: AttributeType[]): Record<string, string> {
  return attributes.reduce<Record<string, string>>((result, attribute) => {
    if (attribute.Name && attribute.Value) {
      result[attribute.Name] = attribute.Value
    }
    return result
  }, {})
}

function isCognitoError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === name
}

function escapeCognitoFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
