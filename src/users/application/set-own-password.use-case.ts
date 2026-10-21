import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { InvalidInputError } from '../../common/domain-error'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { putUserAccount } from './put-user-account.util'

@Injectable()
export class SetOwnPasswordUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, password: string): Promise<void> {
    const record = await this.cognitoUserPort.getUserByUsername(user.username)

    if (record.attributes.email_verified !== 'true') {
      throw new InvalidInputError('Your email must be verified before setting a password.')
    }

    await this.cognitoUserPort.setUserPassword(user.username, password, true)

    await putUserAccount(this.userAccountRepository, {
      userId: user.sub,
      username: user.username,
      email: user.email,
      name: user.name,
      passwordStatus: 'SET',
      auditActor: buildUserAuditMutationContext(user, 'Own password set'),
    })
  }
}
