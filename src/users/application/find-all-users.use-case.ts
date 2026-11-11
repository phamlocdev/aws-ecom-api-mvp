import { Inject, Injectable } from '@nestjs/common'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import { ManagedUser } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { findAllManagedUsers } from './managed-user.util'

@Injectable()
export class FindAllUsersUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(): Promise<ManagedUser[]> {
    return findAllManagedUsers(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
    )
  }
}
