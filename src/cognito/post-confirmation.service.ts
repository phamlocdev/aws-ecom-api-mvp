import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import type { PostConfirmationTriggerEvent } from 'aws-lambda'
import { SesMailService } from '../mail/ses-mail.service'
import {
  USER_ACCOUNT_REPOSITORY,
  UserAccountRepositoryPort,
} from '../users/domain/user-account.repository.port'
import { UserAccount } from '../users/domain/user.entity'

@Injectable()
export class PostConfirmationService {
  private readonly logger = new Logger(PostConfirmationService.name)
  private readonly defaultGroup: string
  private readonly cognitoClient: CognitoIdentityProviderClient

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(USER_ACCOUNT_REPOSITORY)
    private readonly userAccountRepository: UserAccountRepositoryPort,
    @Inject(SesMailService)
    private readonly sesMailService: SesMailService,
  ) {
    this.defaultGroup = configService.get<string>('COGNITO_DEFAULT_GROUP') ?? 'customer'
    const region =
      configService.get<string>('AWS_REGION') ??
      configService.get<string>('AWS_DEFAULT_REGION') ??
      'ap-southeast-1'

    this.cognitoClient = new CognitoIdentityProviderClient({ region })
  }

  async handle(event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> {
    if (!event.userPoolId || !event.userName) {
      this.logger.warn(
        JSON.stringify({
          action: 'post-confirmation-skipped',
          reason: 'missing-user-pool-id-or-user-name',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
        }),
      )
      return event
    }

    this.logger.log(
      JSON.stringify({
        action: 'post-confirmation-start',
        triggerSource: event.triggerSource,
        userPoolId: event.userPoolId,
        userName: event.userName,
      }),
    )

    // Only create user account and send welcome email if the trigger source is PostConfirmation_ConfirmSignUp
    // And skip for PostConfirmation_ConfirmForgotPassword, PostConfirmation_ConfirmSignIn, and PostConfirmation_ConfirmSignUp_AdminCreateUser
    if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
      await this.cognitoClient.send(
        new AdminAddUserToGroupCommand({
          GroupName: this.defaultGroup,
          UserPoolId: event.userPoolId,
          Username: event.userName,
        }),
      )

      this.logger.log(
        JSON.stringify({
          action: 'user-added-to-group',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          groupName: this.defaultGroup,
        }),
      )

      await this.createUserAccount(event)
      await this.sendWelcomeEmailBestEffort(event)
    }

    this.logger.log(
      JSON.stringify({
        action: 'post-confirmation-finished',
        triggerSource: event.triggerSource,
        userPoolId: event.userPoolId,
        userName: event.userName,
      }),
    )
    return event
  }

  private async createUserAccount(event: PostConfirmationTriggerEvent): Promise<void> {
    const attributes = event.request.userAttributes ?? {}
    const sub = attributes.sub

    if (!sub) {
      this.logger.warn(
        JSON.stringify({
          action: 'account-metadata-creation-skipped',
          reason: 'missing-sub',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
        }),
      )
      return
    }

    const timestamp = new Date().toISOString()
    const account: UserAccount = {
      userId: sub,
      username: event.userName,
      ...(attributes.email ? { email: attributes.email } : {}),
      ...(attributes.name ? { name: attributes.name } : {}),
      status: 'ACTIVE',
      passwordStatus: isFederatedSignUp(event) ? 'REQUIRED' : 'SET',
      permissions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.userAccountRepository.save(account)
    this.logger.log(
      JSON.stringify({
        action: 'account-metadata-created',
        triggerSource: event.triggerSource,
        userPoolId: event.userPoolId,
        userName: event.userName,
        userId: sub,
        status: 'ACTIVE',
        passwordStatus: isFederatedSignUp(event) ? 'REQUIRED' : 'SET',
        createdAt: timestamp,
      }),
    )
  }

  private async sendWelcomeEmailBestEffort(event: PostConfirmationTriggerEvent): Promise<void> {
    const attributes = event.request.userAttributes ?? {}
    const sub = attributes.sub
    const email = attributes.email

    if (!sub || !email) {
      this.logger.warn(
        JSON.stringify({
          action: 'welcome-email-skipped',
          reason: !sub ? 'missing-sub' : 'missing-email',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId: sub,
        }),
      )
      return
    }

    try {
      const result = await this.sesMailService.sendWelcomeNewCustomerEmail({
        user: {
          sub,
          username: event.userName,
          email,
          name: attributes.name,
        },
      })

      if (result.status === 'SKIPPED') {
        this.logger.warn(
          JSON.stringify({
            action: 'welcome-email-skipped',
            reason: result.reason ?? 'unknown-reason',
            triggerSource: event.triggerSource,
            userPoolId: event.userPoolId,
            userName: event.userName,
            userId: sub,
            status: result.status,
          }),
        )
        return
      }

      this.logger.log(
        JSON.stringify({
          action: 'welcome-email-sent',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId: sub,
          status: result.status,
          messageId: result.messageId,
        }),
      )
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          action: 'welcome-email-send-failed',
          triggerSource: event.triggerSource,
          userPoolId: event.userPoolId,
          userName: event.userName,
          userId: sub,
        }),
        error instanceof Error ? error.stack : undefined,
      )
    }
  }
}

function isFederatedSignUp(event: PostConfirmationTriggerEvent): boolean {
  const attributes = event.request.userAttributes ?? {}
  const identities = attributes.identities

  if (event.userName.toLowerCase().startsWith('google_')) {
    return true
  }

  if (!identities) {
    return false
  }

  try {
    const parsed = JSON.parse(identities) as Array<Record<string, unknown>>
    return parsed.some((identity) => {
      const providerName = identity.providerName
      const providerType = identity.providerType
      return (
        (typeof providerName === 'string' && providerName.toLowerCase() === 'google') ||
        (typeof providerType === 'string' && providerType.toLowerCase() === 'google')
      )
    })
  } catch {
    return false
  }
}
