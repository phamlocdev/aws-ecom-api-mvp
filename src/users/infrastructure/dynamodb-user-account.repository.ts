import { Inject, Injectable } from '@nestjs/common'
import { BaseDynamoDbRepository } from '../../common/base-dynamodb.repository'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { DynamoDbService } from '../../dynamodb/dynamodb.service'
import { UserAccount, UserLoginAudit } from '../domain/user.entity'
import {
  AuthenticationLoginFields,
  LoginAuditContextFields,
  LoginAuditQueryResult,
  LoginContextFields,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'

@Injectable()
export class DynamoDbUserAccountRepository
  extends BaseDynamoDbRepository<UserAccount>
  implements UserAccountRepositoryPort
{
  protected readonly tableName: string
  protected readonly primaryKeyName = 'userId'
  private readonly userLoginAuditTableName: string

  constructor(
    @Inject(DynamoDbService)
    dynamoDbService: DynamoDbService,
    @Inject(DynamoTablesService)
    dynamoTables: DynamoTablesService,
  ) {
    super(dynamoDbService)
    this.tableName = dynamoTables.userAccounts
    this.userLoginAuditTableName = dynamoTables.userLoginAudit
  }

  protected fromRecord(item: Record<string, unknown>): UserAccount {
    return UserAccount.fromRecord(item)
  }

  protected toRecord(entity: UserAccount): Record<string, unknown> {
    return { ...entity }
  }

  async updateLoginContext(userId: string, fields: LoginContextFields): Promise<void> {
    const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' }
    const expressionAttributeValues: Record<string, unknown> = { ':updatedAt': fields.updatedAt }
    const setExpressions = ['#updatedAt = :updatedAt']

    if (fields.lastLoginIp) {
      expressionAttributeNames['#lastLoginIp'] = 'lastLoginIp'
      expressionAttributeValues[':lastLoginIp'] = fields.lastLoginIp
      setExpressions.push('#lastLoginIp = :lastLoginIp')
    }

    if (fields.lastLoginUserAgent) {
      expressionAttributeNames['#lastLoginUserAgent'] = 'lastLoginUserAgent'
      expressionAttributeValues[':lastLoginUserAgent'] = fields.lastLoginUserAgent
      setExpressions.push('#lastLoginUserAgent = :lastLoginUserAgent')
    }

    await this.updateItem(
      this.tableName,
      { userId },
      `SET ${setExpressions.join(', ')}`,
      expressionAttributeNames,
      expressionAttributeValues,
    )
  }

  async recordAuthenticationLogin(
    userId: string,
    fields: AuthenticationLoginFields,
  ): Promise<void> {
    await this.updateItem(
      this.tableName,
      { userId },
      [
        'SET #username = if_not_exists(#username, :username)',
        '#email = if_not_exists(#email, :email)',
        '#status = if_not_exists(#status, :active)',
        '#passwordStatus = if_not_exists(#passwordStatus, :passwordStatus)',
        '#permissions = if_not_exists(#permissions, :emptyPermissions)',
        '#createdAt = if_not_exists(#createdAt, :loginAt)',
        '#lastLoginAt = :loginAt',
        '#loginCount = if_not_exists(#loginCount, :zero) + :one',
        '#updatedAt = :loginAt',
      ].join(', '),
      {
        '#username': 'username',
        '#email': 'email',
        '#status': 'status',
        '#passwordStatus': 'passwordStatus',
        '#permissions': 'permissions',
        '#createdAt': 'createdAt',
        '#lastLoginAt': 'lastLoginAt',
        '#loginCount': 'loginCount',
        '#updatedAt': 'updatedAt',
      },
      {
        ':username': fields.username,
        ':email': fields.email ?? '',
        ':active': 'ACTIVE',
        ':passwordStatus': fields.passwordStatus,
        ':emptyPermissions': [],
        ':loginAt': fields.loginAt,
        ':zero': 0,
        ':one': 1,
      },
    )
  }

  async insertLoginAudit(entry: UserLoginAudit): Promise<void> {
    await this.putRecord(this.userLoginAuditTableName, { ...entry })
  }

  async findLatestLoginAudit(userId: string): Promise<UserLoginAudit | undefined> {
    const response = await this.queryItems({
      TableName: this.userLoginAuditTableName,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: 1,
    })

    return response.Items?.[0] ? UserLoginAudit.fromRecord(response.Items[0]) : undefined
  }

  async updateLoginAuditContext(
    userId: string,
    loginAt: string,
    fields: LoginAuditContextFields,
  ): Promise<void> {
    const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' }
    const expressionAttributeValues: Record<string, unknown> = { ':updatedAt': fields.updatedAt }
    const setExpressions = ['#updatedAt = :updatedAt']

    if (fields.ipAddress) {
      expressionAttributeNames['#ipAddress'] = 'ipAddress'
      expressionAttributeValues[':ipAddress'] = fields.ipAddress
      setExpressions.push('#ipAddress = :ipAddress')
    }

    if (fields.userAgent) {
      expressionAttributeNames['#userAgent'] = 'userAgent'
      expressionAttributeValues[':userAgent'] = fields.userAgent
      setExpressions.push('#userAgent = :userAgent')
    }

    await this.updateItem(
      this.userLoginAuditTableName,
      { userId, loginAt },
      `SET ${setExpressions.join(', ')}`,
      expressionAttributeNames,
      expressionAttributeValues,
    )
  }

  async queryLoginAudit(
    userId: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<LoginAuditQueryResult> {
    const response = await this.queryItems({
      TableName: this.userLoginAuditTableName,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    })

    return {
      items: (response.Items ?? []).map(UserLoginAudit.fromRecord),
      lastEvaluatedKey: response.LastEvaluatedKey as Record<string, unknown> | undefined,
    }
  }
}
