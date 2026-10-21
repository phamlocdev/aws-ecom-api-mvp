import { Module } from '@nestjs/common'
import { MailModule } from '../../mail/mail.module'
import { UploadModule } from '../../upload/upload.module'
import { CreateManagedUserUseCase } from '../application/create-managed-user.use-case'
import { DisableManagedUserUseCase } from '../application/disable-managed-user.use-case'
import { FindAllUsersUseCase } from '../application/find-all-users.use-case'
import { FindCustomerProfileByUsernameUseCase } from '../application/find-customer-profile-by-username.use-case'
import { FindLoginAuditUseCase } from '../application/find-login-audit.use-case'
import { GetOwnProfileUseCase } from '../application/get-own-profile.use-case'
import { GetWelcomeEmailStatisticsUseCase } from '../application/get-welcome-email-statistics.use-case'
import { GetWelcomeEmailTrackingUseCase } from '../application/get-welcome-email-tracking.use-case'
import { RecordLoginContextUseCase } from '../application/record-login-context.use-case'
import { ResendFailedWelcomeEmailUseCase } from '../application/resend-failed-welcome-email.use-case'
import { ResetManagedUserPasswordUseCase } from '../application/reset-managed-user-password.use-case'
import { SetOwnPasswordUseCase } from '../application/set-own-password.use-case'
import { UpdateManagedUserUseCase } from '../application/update-managed-user.use-case'
import { UpdateOwnProfileUseCase } from '../application/update-own-profile.use-case'
import { UpdateUserPermissionsUseCase } from '../application/update-user-permissions.use-case'
import { COGNITO_USER_REPOSITORY } from '../domain/cognito-user.port'
import { USER_ACCOUNT_REPOSITORY } from '../domain/user-account.repository.port'
import { CognitoUserRepository } from '../infrastructure/cognito-user.repository'
import { DynamoDbUserAccountRepository } from '../infrastructure/dynamodb-user-account.repository'
import { UsersController } from './users.controller'

@Module({
  imports: [MailModule, UploadModule],
  controllers: [UsersController],
  providers: [
    { provide: COGNITO_USER_REPOSITORY, useClass: CognitoUserRepository },
    { provide: USER_ACCOUNT_REPOSITORY, useClass: DynamoDbUserAccountRepository },
    CreateManagedUserUseCase,
    DisableManagedUserUseCase,
    FindAllUsersUseCase,
    FindCustomerProfileByUsernameUseCase,
    FindLoginAuditUseCase,
    GetOwnProfileUseCase,
    GetWelcomeEmailStatisticsUseCase,
    GetWelcomeEmailTrackingUseCase,
    RecordLoginContextUseCase,
    ResendFailedWelcomeEmailUseCase,
    ResetManagedUserPasswordUseCase,
    SetOwnPasswordUseCase,
    UpdateManagedUserUseCase,
    UpdateOwnProfileUseCase,
    UpdateUserPermissionsUseCase,
  ],
  exports: [FindCustomerProfileByUsernameUseCase],
})
export class UsersModule {}
