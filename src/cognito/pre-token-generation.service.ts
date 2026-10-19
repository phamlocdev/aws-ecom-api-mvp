import { Inject, Injectable } from '@nestjs/common'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda'
import { normalizePermissions } from '../auth/permissions'
import { DynamoTablesService } from '../config/dynamo-tables.service'
import { DynamoDbService } from '../dynamodb/dynamodb.service'

type UserAccountRecord = {
  userId: string
  permissions?: unknown
  passwordStatus?: 'REQUIRED' | 'SET'
}

@Injectable()
export class PreTokenGenerationService {
  private readonly userAccountsTableName: string

  constructor(
    @Inject(DynamoTablesService) dynamoTables: DynamoTablesService,
    @Inject(DynamoDbService)
    private readonly dynamoDbService: DynamoDbService,
  ) {
    this.userAccountsTableName = dynamoTables.userAccounts
  }

  async handle(event: PreTokenGenerationV2TriggerEvent): Promise<PreTokenGenerationV2TriggerEvent> {
    const userId = event.request.userAttributes.sub
    const account = userId ? await this.findAccount(userId) : undefined
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

  private async findAccount(userId: string): Promise<UserAccountRecord | undefined> {
    const response = await this.dynamoDbService.documentClient.send(
      new GetCommand({
        TableName: this.userAccountsTableName,
        Key: { userId },
      }),
    )

    return response.Item as UserAccountRecord | undefined
  }
}

function resolvePasswordStatus(
  account: UserAccountRecord | undefined,
  username: string | undefined,
): 'REQUIRED' | 'SET' {
  if (account?.passwordStatus) {
    return account.passwordStatus
  }

  return username?.toLowerCase().startsWith('google_') ? 'REQUIRED' : 'SET'
}
