import { Inject, Injectable, Logger } from '@nestjs/common'
import type { PreAuthenticationTriggerEvent } from 'aws-lambda'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../users/domain/user-account.repository.port'
import { UserAccountStatus } from '../users/domain/user.entity'

const BLOCKED_STATUSES = new Set<UserAccountStatus>(['SUSPENDED', 'PENDING_APPROVAL', 'DELETED'])

@Injectable()
export class PreAuthenticationService {
  private readonly logger = new Logger(PreAuthenticationService.name)

  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
  ) {}

  async handle(event: PreAuthenticationTriggerEvent): Promise<PreAuthenticationTriggerEvent> {
    const userId = event.request.userAttributes.sub

    if (!userId) {
      this.logger.warn(
        JSON.stringify({
          decision: 'ALLOW',
          reason: 'missing-sub',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
        }),
      )
      return event
    }

    const account = await this.userAccountRepository.findById(userId)
    const status = account?.status

    if (status && BLOCKED_STATUSES.has(status)) {
      this.logger.warn(
        JSON.stringify({
          decision: 'DENY',
          reason: 'blocked-account-status',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId,
          status,
        }),
      )
      throw new Error('This account is not allowed to sign in.')
    }

    this.logger.log(
      JSON.stringify({
        decision: 'ALLOW',
        triggerSource: event.triggerSource,
        userPoolId: event.userPoolId,
        userName: event.userName,
        userId,
        status: status ?? 'LEGACY_MISSING_STATUS',
      }),
    )

    return event
  }
}
