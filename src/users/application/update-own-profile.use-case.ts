import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { InvalidInputError } from '../../common/domain-error'
import { UploadService } from '../../upload/upload.service'
import { UserAddress, UserProfile } from '../domain/user.entity'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../domain/user-account.repository.port'
import {
  mergeAuthenticatedUserProfile,
  normalizeUserAddress,
  toUserProfile,
} from '../domain/user.rules'
import { FindCustomerProfileByUsernameUseCase } from './find-customer-profile-by-username.use-case'
import { findCognitoProfileForAuthenticatedUser, withAvatarReadUrl } from './own-profile.util'
import { putUserAccount } from './put-user-account.util'

export interface UpdateOwnProfileInput {
  name?: string
  avatarKey?: string | null
  address?: UserAddress
}

@Injectable()
export class UpdateOwnProfileUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(UploadService)
    private readonly uploadService: UploadService,
    @Inject(FindCustomerProfileByUsernameUseCase)
    private readonly findCustomerProfileByUsernameUseCase: FindCustomerProfileByUsernameUseCase,
  ) {}

  async execute(user: AuthenticatedUser, input: UpdateOwnProfileInput): Promise<UserProfile> {
    const account = await this.userAccountRepository.findById(user.sub)
    const cognitoProfile = await findCognitoProfileForAuthenticatedUser(
      this.findCustomerProfileByUsernameUseCase,
      user,
      account,
    )
    const profileUser = mergeAuthenticatedUserProfile(user, account, cognitoProfile)
    const previousAvatarKey = account?.avatarKey

    if (typeof input.avatarKey === 'string') {
      if (!this.uploadService.isAvatarKeyForUser(input.avatarKey, user.sub)) {
        throw new InvalidInputError('avatarKey must belong to the authenticated user.')
      }

      await this.uploadService.verifyObjectsExist([input.avatarKey])
    }

    const nextAvatarKey = input.avatarKey === null ? null : (input.avatarKey ?? account?.avatarKey)
    const nextAccount = await putUserAccount(this.userAccountRepository, {
      userId: user.sub,
      username: user.username,
      email: profileUser.email,
      name: input.name !== undefined ? input.name : (account?.name ?? profileUser.name),
      avatarKey: nextAvatarKey,
      address: input.address !== undefined ? normalizeUserAddress(input.address) : account?.address,
      permissions: account?.permissions ?? [],
      auditActor: buildUserAuditMutationContext(user, 'Own profile updated'),
    })

    if (previousAvatarKey && previousAvatarKey !== nextAvatarKey) {
      await this.uploadService.deleteObjectsBestEffort([previousAvatarKey])
    }

    return withAvatarReadUrl(this.uploadService, toUserProfile(profileUser, nextAccount))
  }
}
