import { Inject, Injectable, Logger } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'

export interface RecordLoginContextInput {
  ipAddress?: string
  userAgent?: string
}

@Injectable()
export class RecordLoginContextUseCase {
  private readonly logger = new Logger(RecordLoginContextUseCase.name)

  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, input: RecordLoginContextInput): Promise<void> {
    const updatedAt = new Date().toISOString()

    await this.userAccountRepository.updateLoginContext(user.sub, {
      updatedAt,
      lastLoginIp: input.ipAddress,
      lastLoginUserAgent: input.userAgent,
    })

    const latestAudit = await this.userAccountRepository.findLatestLoginAudit(user.sub)
    if (latestAudit && (input.ipAddress || input.userAgent)) {
      await this.userAccountRepository.updateLoginAuditContext(user.sub, latestAudit.loginAt, {
        updatedAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
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
}
