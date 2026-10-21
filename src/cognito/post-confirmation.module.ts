import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DynamoDbModule } from '../dynamodb/dynamodb.module'
import { MailModule } from '../mail/mail.module'
import { validateRuntimeEnv } from '../config/env.validation'
import { USER_ACCOUNT_REPOSITORY } from '../users/domain/user-account.repository.port'
import { DynamoDbUserAccountRepository } from '../users/infrastructure/dynamodb-user-account.repository'
import { PostConfirmationService } from './post-confirmation.service'

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
    PostConfirmationService,
    { provide: USER_ACCOUNT_REPOSITORY, useClass: DynamoDbUserAccountRepository },
  ],
  exports: [PostConfirmationService],
})
export class PostConfirmationModule {}
