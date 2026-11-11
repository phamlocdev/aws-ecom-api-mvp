import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DynamoDbModule } from '../dynamodb/dynamodb.module'
import { MailModule } from '../mail/mail.module'
import { validateRuntimeEnv } from '../config/env.validation'
import { USER_ACCOUNT_REPOSITORY } from '../users/domain/user-account.repository.port'
import { DynamoDbUserAccountRepository } from '../users/infrastructure/dynamodb-user-account.repository'
import { CustomEmailSenderService } from './custom-email-sender.service'
import { PostAuthenticationService } from './post-authentication.service'
import { PreAuthenticationService } from './pre-authentication.service'
import { PreSignUpService } from './pre-sign-up.service'
import { PreTokenGenerationService } from './pre-token-generation.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.RUNTIME_ENV_FILE ?? '.env.dev',
      validate: validateRuntimeEnv,
    }),
    DynamoDbModule,
    MailModule,
  ],
  providers: [
    CustomEmailSenderService,
    PostAuthenticationService,
    PreAuthenticationService,
    PreSignUpService,
    PreTokenGenerationService,
    { provide: USER_ACCOUNT_REPOSITORY, useClass: DynamoDbUserAccountRepository },
  ],
  exports: [
    CustomEmailSenderService,
    PostAuthenticationService,
    PreAuthenticationService,
    PreSignUpService,
    PreTokenGenerationService,
  ],
})
export class CognitoTriggersModule {}
