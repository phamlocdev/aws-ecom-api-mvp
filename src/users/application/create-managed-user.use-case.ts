import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { normalizePermissions, Permission } from '../../auth/permissions'
import { Role } from '../../auth/roles.enum'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import { ManagedUser } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { findManagedUserByUsername } from './managed-user.util'
import { putUserAccount } from './put-user-account.util'

export interface CreateManagedUserInput {
  username: string
  email: string
  password: string
  name?: string
  group: Role
  permissions?: Permission[]
}

@Injectable()
export class CreateManagedUserUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(actor: AuthenticatedUser, input: CreateManagedUserInput): Promise<ManagedUser> {
    await this.cognitoUserPort.createUser({
      username: input.username,
      email: input.email,
      name: input.name,
      temporaryPassword: input.password,
    })

    await this.cognitoUserPort.addUserToGroup(input.username, input.group)

    const user = await findManagedUserByUsername(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      input.username,
    )
    if (user.sub) {
      await putUserAccount(this.userAccountRepository, {
        userId: user.sub,
        username: user.username,
        email: user.email,
        name: user.name,
        permissions: normalizePermissions(input.permissions),
        passwordStatus: 'SET',
        auditActor: buildUserAuditMutationContext(actor, 'Managed user created'),
      })
    }

    return findManagedUserByUsername(
      this.cognitoUserPort,
      this.userAccountRepository,
      this.emailTrackingService,
      input.username,
    )
  }
}
