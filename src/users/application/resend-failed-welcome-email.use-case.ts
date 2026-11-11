import { Inject, Injectable } from '@nestjs/common'
import { InvalidInputError } from '../../common/domain-error'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { SesMailService } from '../../mail/ses-mail.service'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import { ResendUserEmailResult } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { normalizeEmail } from '../domain/user.rules'
import { findManagedUserBySub } from './managed-user.util'

@Injectable()
export class ResendFailedWelcomeEmailUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
    @Inject(SesMailService)
    private readonly sesMailService: SesMailService,
  ) {}

  async execute(userId: string, recipientEmail: string): Promise<ResendUserEmailResult> {
    const user = await findManagedUserBySub(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      userId,
    )
    const normalizedRecipientEmail = normalizeEmail(recipientEmail)
    if (!normalizedRecipientEmail) {
      throw new InvalidInputError('recipientEmail is required.')
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
}
