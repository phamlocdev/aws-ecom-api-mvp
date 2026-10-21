import { Inject, Injectable } from '@nestjs/common'
import { COGNITO_USER_REPOSITORY, CognitoUserPort } from '../domain/cognito-user.port'
import { CustomerProfile } from '../domain/user.entity'

@Injectable()
export class FindCustomerProfileByUsernameUseCase {
  constructor(
    @Inject(COGNITO_USER_REPOSITORY)
    private readonly cognitoUserPort: CognitoUserPort,
  ) {}

  async execute(username: string): Promise<CustomerProfile> {
    const record = await this.cognitoUserPort.getUserByUsername(username)

    return {
      username,
      email: record.attributes.email,
      name: record.attributes.name,
      sub: record.attributes.sub,
    }
  }
}
