import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { normalizePermissions, Permission } from '../../auth/permissions'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import { UserPermissionsRecord } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { toUserPermissionsRecord } from '../domain/user.rules'
import { findManagedUserBySub } from './managed-user.util'
import { putUserAccount } from './put-user-account.util'

@Injectable()
export class UpdateUserPermissionsUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(
    userId: string,
    permissions: Permission[],
    actor: AuthenticatedUser,
  ): Promise<UserPermissionsRecord> {
    await findManagedUserBySub(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      userId,
    )

    const record = await putUserAccount(this.userAccountRepository, {
      userId,
      permissions: normalizePermissions(permissions),
      auditActor: buildUserAuditMutationContext(actor, 'Managed user permissions updated'),
    })

    return toUserPermissionsRecord(record)
  }
}
