import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { findManagedUserBySub } from './managed-user.util'
import { putUserAccount } from './put-user-account.util'

@Injectable()
export class DisableManagedUserUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(userId: string, actor?: AuthenticatedUser): Promise<void> {
    const user = await findManagedUserBySub(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      userId,
    )

    await this.cognitoUserPort.disableUser(user.username)

    await putUserAccount(this.userAccountRepository, {
      userId,
      username: user.username,
      email: user.email,
      name: user.name,
      permissions: user.permissions,
      status: 'SUSPENDED',
      auditActor: actor
        ? buildUserAuditMutationContext(actor, 'Managed user disabled')
        : systemAuditMutationContext('users-service', 'Managed user disabled'),
    })
  }
}
