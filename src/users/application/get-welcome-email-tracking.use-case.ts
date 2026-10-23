import { Inject, Injectable } from '@nestjs/common'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { EmailTrackingView } from '../../mail/domain/email-tracking.entity'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { findManagedUserBySub } from './managed-user.util'

@Injectable()
export class GetWelcomeEmailTrackingUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(userId: string): Promise<EmailTrackingView[]> {
    await findManagedUserBySub(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      userId,
    )
    return this.emailTrackingService.findByContext('USER', userId, ['WELCOME_NEW_CUSTOMER'])
  }
}
