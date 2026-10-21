import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type { PostAuthenticationTriggerEvent } from 'aws-lambda'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../users/domain/user-account.repository.port'
import { isGoogleFederatedUsername } from '../users/domain/user.rules'

const AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60

@Injectable()
export class PostAuthenticationService {
  private readonly logger = new Logger(PostAuthenticationService.name)

  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
  ) {}

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
      await this.userAccountRepository.recordAuthenticationLogin(userId, {
        username: event.userName,
        email: event.request.userAttributes.email,
        passwordStatus: isGoogleFederatedUsername(event.userName) ? 'REQUIRED' : 'SET',
        loginAt,
      })

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
      await this.userAccountRepository.insertLoginAudit({
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
      })
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
