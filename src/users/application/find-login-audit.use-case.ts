import { Inject, Injectable } from '@nestjs/common'
import { InvalidInputError, NotFoundError } from '../../common/domain-error'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import { UserLoginAuditQueryResult } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { decodeCursor, encodeCursor, normalizeEmail } from '../domain/user.rules'
import { findManagedUserByUsername } from './managed-user.util'

export interface FindLoginAuditInput {
  userId?: string
  username?: string
  email?: string
  limit?: number
  cursor?: string
}

@Injectable()
export class FindLoginAuditUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(input: FindLoginAuditInput): Promise<UserLoginAuditQueryResult> {
    const userId = await this.resolveLoginAuditUserId(input)
    const requestedLimit = Number.isFinite(input.limit) ? input.limit : 25
    const limit = Math.min(Math.max(requestedLimit ?? 25, 1), 100)

    const result = await this.userAccountRepository.queryLoginAudit(
      userId,
      limit,
      decodeCursor(input.cursor),
    )

    return UserLoginAuditQueryResult.fromParts(result.items, encodeCursor(result.lastEvaluatedKey))
  }

  private async resolveLoginAuditUserId(input: {
    userId?: string
    username?: string
    email?: string
  }): Promise<string> {
    const filters = [input.userId, input.username, input.email].filter(Boolean)
    if (filters.length !== 1) {
      throw new InvalidInputError('Provide exactly one of userId, username, or email.')
    }

    if (input.userId) {
      return input.userId
    }

    if (input.username) {
      const user = await findManagedUserByUsername(
        this.cognitoUserPort,
        this.userAccountRepository,
        this.emailTrackingService,
        input.username,
      )
      if (!user.sub) {
        throw new NotFoundError(`User ${input.username} does not have a sub attribute.`)
      }
      return user.sub
    }

    const email = normalizeEmail(input.email)
    if (!email) {
      throw new InvalidInputError('email must be a valid non-empty value.')
    }

    const record = await this.cognitoUserPort.findUserByEmail(email)
    const sub = record?.attributes.sub
    if (!record || !sub) {
      throw new NotFoundError(`User with email ${email} was not found.`)
    }

    return sub
  }
}
