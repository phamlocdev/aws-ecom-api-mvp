import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { UploadService } from '../../upload/upload.service'
import { UserProfile } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import { mergeAuthenticatedUserProfile, toUserProfile } from '../domain/user.rules'
import { FindCustomerProfileByUsernameUseCase } from './find-customer-profile-by-username.use-case'
import {
  backfillStoredAccountProfile,
  findCognitoProfileForAuthenticatedUser,
  withAvatarReadUrl,
} from './own-profile.util'

@Injectable()
export class GetOwnProfileUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
    @Inject(FindCustomerProfileByUsernameUseCase)
    private readonly findCustomerProfileByUsernameUseCase: FindCustomerProfileByUsernameUseCase,
  ) {}

  async execute(user: AuthenticatedUser): Promise<UserProfile> {
    const account = await this.userAccountRepository.findById(user.sub)
    const cognitoProfile = await findCognitoProfileForAuthenticatedUser(
      this.findCustomerProfileByUsernameUseCase,
      user,
      account,
    )
    const profileUser = mergeAuthenticatedUserProfile(user, account, cognitoProfile)
    const storedAccount = await backfillStoredAccountProfile(
      this.userAccountRepository,
      profileUser,
      account,
    )

    return withAvatarReadUrl(this.uploadService, toUserProfile(profileUser, storedAccount))
  }
}
