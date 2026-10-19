import { Inject, Injectable, Logger } from '@nestjs/common'
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import type { PostAuthenticationTriggerEvent } from 'aws-lambda'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'

const AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60

@Injectable()
export class PostAuthenticationService {
  private readonly logger = new Logger(PostAuthenticationService.name)
  private readonly userAccountsTableName: string
  private readonly userLoginAuditTableName: string

  constructor(
    @Inject(DynamoTablesService) dynamoTables: DynamoTablesService,
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
  ) {
    this.userAccountsTableName = dynamoTables.userAccounts
    this.userLoginAuditTableName = dynamoTables.userLoginAudit
  }

  async handle(event: PostAuthenticationTriggerEvent): Promise<PostAuthenticationTriggerEvent> {
    const userId = event.request.userAttributes.sub
    const loginAt = new Date().toISOString()
    const expiresAt = Math.floor(Date.now() / 1000) + AUDIT_RETENTION_SECONDS

    if (!userId) {
      this.logger.warn(
        JSON.stringify({
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          reason: 'missing-sub',
        }),
      )
      return event
    }

    await this.updateLoginSummary(event, userId, loginAt)
    await this.writeLoginAudit(event, userId, loginAt, expiresAt)

    return event
  }

  private async updateLoginSummary(
    event: PostAuthenticationTriggerEvent,
    userId: string,
    loginAt: string,
  ): Promise<void> {
    try {
      await this.dynamoDbService.documentClient.send(
        new UpdateCommand({
          TableName: this.userAccountsTableName,
          Key: { userId },
          UpdateExpression: [
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
          ExpressionAttributeNames: {
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
          ExpressionAttributeValues: {
            ':username': event.userName,
            ':email': event.request.userAttributes.email ?? '',
            ':active': 'ACTIVE',
            ':passwordStatus': isGoogleFederatedUsername(event.userName) ? 'REQUIRED' : 'SET',
            ':emptyPermissions': [],
            ':loginAt': loginAt,
            ':zero': 0,
            ':one': 1,
          },
        }),
      )

      this.logger.log(
        JSON.stringify({
          action: 'login-summary-updated',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId,
          loginAt,
        }),
      )
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          action: 'login-summary-update-failed',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId,
        }),
        error instanceof Error ? error.stack : undefined,
      )
      throw error
    }
  }

  private async writeLoginAudit(
    event: PostAuthenticationTriggerEvent,
    userId: string,
    loginAt: string,
    expiresAt: number,
  ): Promise<void> {
    try {
      await this.dynamoDbService.documentClient.send(
        new PutCommand({
          TableName: this.userLoginAuditTableName,
          Item: {
            userId,
            loginAt,
            loginId: randomUUID(),
            username: event.userName,
            ...(event.request.userAttributes.email
              ? { email: event.request.userAttributes.email }
              : {}),
            userPoolId: event.userPoolId,
            clientId: event.callerContext.clientId,
            triggerSource: event.triggerSource,
            newDeviceUsed: event.request.newDeviceUsed,
            createdAt: loginAt,
            expiresAt,
          },
        }),
      )
      this.logger.log(
        JSON.stringify({
          action: 'login-audit-written',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId,
          loginAt,
          expiresAt,
        }),
      )
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          action: 'login-audit-write-failed',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId,
          loginAt,
        }),
        error instanceof Error ? error.stack : undefined,
      )
      throw error
    }
  }
}

function isGoogleFederatedUsername(username: string | undefined): boolean {
  return Boolean(username?.toLowerCase().startsWith('google_'))
}
