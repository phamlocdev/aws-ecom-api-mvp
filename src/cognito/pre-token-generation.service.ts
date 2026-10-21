import { Inject, Injectable } from '@nestjs/common'
import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda'
import { normalizePermissions } from '../auth/permissions'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../users/domain/user-account.repository.port'
import { resolvePasswordStatus } from '../users/domain/user.rules'

@Injectable()
export class PreTokenGenerationService {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
  ) {}

  async handle(event: PreTokenGenerationV2TriggerEvent): Promise<PreTokenGenerationV2TriggerEvent> {
    const userId = event.request.userAttributes.sub
    const account = userId ? await this.userAccountRepository.findById(userId) : null
    const permissions = normalizePermissions(account?.permissions)
    const passwordStatus = resolvePasswordStatus(account, event.userName)

    event.response.claimsAndScopeOverrideDetails ??= {}
    event.response.claimsAndScopeOverrideDetails.accessTokenGeneration ??= {}
    event.response.claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride = {
      ...(event.response.claimsAndScopeOverrideDetails.accessTokenGeneration
        .claimsToAddOrOverride ?? {}),
      'app:permissions': permissions,
      'app:password_status': passwordStatus,
    } as unknown as Record<string, string>
    event.response.claimsAndScopeOverrideDetails.idTokenGeneration ??= {}
    event.response.claimsAndScopeOverrideDetails.idTokenGeneration.claimsToAddOrOverride = {
      ...(event.response.claimsAndScopeOverrideDetails.idTokenGeneration.claimsToAddOrOverride ??
        {}),
      'app:password_status': passwordStatus,
    } as Record<string, string>

    return event
  }
}
