import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import { ManagedUser, UserAccountStatus } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { DisableManagedUserUseCase } from './disable-managed-user.use-case'
import { findManagedUserBySub } from './managed-user.util'
import { putUserAccount } from './put-user-account.util'

export interface UpdateManagedUserInput {
  email?: string
  name?: string
  enabled?: boolean
  status?: UserAccountStatus
}

@Injectable()
export class UpdateManagedUserUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
    @Inject(DisableManagedUserUseCase)
    private readonly disableManagedUserUseCase: DisableManagedUserUseCase,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    userId: string,
    input: UpdateManagedUserInput,
  ): Promise<ManagedUser> {
    const user = await findManagedUserBySub(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      userId,
    )

    const attributes: Record<string, string> = {}
    if (input.email !== undefined) {
      attributes.email = input.email
      attributes.email_verified = 'true'
    }
    if (input.name !== undefined) {
      attributes.name = input.name
    }

    if (Object.keys(attributes).length > 0) {
      await this.cognitoUserPort.updateUserAttributes(user.username, attributes)

      await putUserAccount(this.userAccountRepository, {
        userId,
        username: user.username,
        email: input.email ?? user.email,
        name: input.name ?? user.name,
        permissions: user.permissions,
        auditActor: buildUserAuditMutationContext(actor, 'Managed user profile updated'),
      })
    }

    if (input.status !== undefined) {
      await putUserAccount(this.userAccountRepository, {
        userId,
        username: user.username,
        email: input.email ?? user.email,
        name: input.name ?? user.name,
        permissions: user.permissions,
        status: input.status,
        auditActor: buildUserAuditMutationContext(actor, 'Managed user status updated'),
      })
    }

    if (input.enabled === true && !user.enabled) {
      await this.cognitoUserPort.enableUser(user.username)
    } else if (input.enabled === false && user.enabled) {
      await this.disableManagedUserUseCase.execute(userId, actor)
    }

    return findManagedUserBySub(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      userId,
    )
  }
}
