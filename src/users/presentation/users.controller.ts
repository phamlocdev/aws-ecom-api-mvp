import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { AuthenticatedRequest } from '../../auth/auth.types'
import { Permission } from '../../auth/permissions'
import { RequirePermissions } from '../../auth/permissions.decorator'
import { Role } from '../../auth/roles.enum'
import { Roles } from '../../auth/roles.decorator'
import { ForbiddenDomainError } from '../../common/domain-error'
import { EmailStatisticsQueryDto } from '../../mail/dto/email-statistics-query.dto'
import { ResendEmailRecipientDto } from '../../mail/dto/resend-email-recipient.dto'
import { EmailDeliveryStatistics } from '../../mail/mail.types'
import { CreateManagedUserUseCase } from '../application/create-managed-user.use-case'
import { DisableManagedUserUseCase } from '../application/disable-managed-user.use-case'
import { FindAllUsersUseCase } from '../application/find-all-users.use-case'
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
import { ManagedUser, UserPermissionsRecord, UserProfile } from '../domain/user.entity'
import { CreateManagedUserDto } from './dto/create-managed-user.dto'
import { ResetManagedUserPasswordDto } from './dto/reset-managed-user-password.dto'
import { SetOwnPasswordDto } from './dto/set-own-password.dto'
import { UpdateManagedUserDto } from './dto/update-managed-user.dto'
import { UpdateUserProfileDto } from './dto/update-user-profile.dto'
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto'

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    @Inject(FindAllUsersUseCase)
    private readonly findAllUsersUseCase: FindAllUsersUseCase,
    @Inject(GetWelcomeEmailStatisticsUseCase)
    private readonly getWelcomeEmailStatisticsUseCase: GetWelcomeEmailStatisticsUseCase,
    @Inject(FindLoginAuditUseCase)
    private readonly findLoginAuditUseCase: FindLoginAuditUseCase,
    @Inject(RecordLoginContextUseCase)
    private readonly recordLoginContextUseCase: RecordLoginContextUseCase,
    @Inject(GetWelcomeEmailTrackingUseCase)
    private readonly getWelcomeEmailTrackingUseCase: GetWelcomeEmailTrackingUseCase,
    @Inject(ResendFailedWelcomeEmailUseCase)
    private readonly resendFailedWelcomeEmailUseCase: ResendFailedWelcomeEmailUseCase,
    @Inject(CreateManagedUserUseCase)
    private readonly createManagedUserUseCase: CreateManagedUserUseCase,
    @Inject(UpdateManagedUserUseCase)
    private readonly updateManagedUserUseCase: UpdateManagedUserUseCase,
    @Inject(UpdateUserPermissionsUseCase)
    private readonly updateUserPermissionsUseCase: UpdateUserPermissionsUseCase,
    @Inject(ResetManagedUserPasswordUseCase)
    private readonly resetManagedUserPasswordUseCase: ResetManagedUserPasswordUseCase,
    @Inject(DisableManagedUserUseCase)
    private readonly disableManagedUserUseCase: DisableManagedUserUseCase,
    @Inject(GetOwnProfileUseCase)
    private readonly getOwnProfileUseCase: GetOwnProfileUseCase,
    @Inject(UpdateOwnProfileUseCase)
    private readonly updateOwnProfileUseCase: UpdateOwnProfileUseCase,
    @Inject(SetOwnPasswordUseCase)
    private readonly setOwnPasswordUseCase: SetOwnPasswordUseCase,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_READ)
  @ApiOperation({ summary: 'List Cognito users with their groups' })
  @ApiOkResponse({ description: 'Returns all Cognito users and their current roles.' })
  findAll(
    @Req() request: AuthenticatedRequest,
    @Query() query: EmailStatisticsQueryDto,
  ): Promise<ManagedUser[] | EmailDeliveryStatistics> {
    if (query.emailStatistics === 'true') {
      if (!request.user?.groups.includes(Role.ADMIN)) {
        throw new ForbiddenDomainError('You do not have permission to view email statistics.')
      }
      return this.getWelcomeEmailStatisticsUseCase.execute()
    }

    return this.findAllUsersUseCase.execute()
  }

  @Get('email-statistics')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_EMAIL_READ)
  @ApiOperation({ summary: 'Get welcome email delivery statistics' })
  @ApiOkResponse({ description: 'Returns counts by welcome email delivery status.' })
  getWelcomeEmailStatistics() {
    return this.getWelcomeEmailStatisticsUseCase.execute()
  }

  @Get('login-audit')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_LOGIN_AUDIT_READ)
  @ApiOperation({ summary: 'Get login audit entries for one user' })
  @ApiOkResponse({ description: 'Returns login audit entries for an exact user identity.' })
  getLoginAudit(
    @Query('userId') userId?: string,
    @Query('username') username?: string,
    @Query('email') email?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.findLoginAuditUseCase.execute({
      userId,
      username,
      email,
      limit: limit ? Number(limit) : undefined,
      cursor,
    })
  }

  @Post('me/login-context')
  @Roles(Role.CUSTOMER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record request-derived login context after sign-in' })
  @ApiNoContentResponse({ description: 'Login context recorded.' })
  recordLoginContext(@Req() request: AuthenticatedRequest): Promise<void> {
    return this.recordLoginContextUseCase.execute(request.user!, {
      ipAddress: getRequestIpAddress(request),
      userAgent: request.get('user-agent') ?? undefined,
    })
  }

  @Get(':userId/email-tracking')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_EMAIL_READ)
  @ApiOperation({ summary: 'Get welcome email tracking attempts for one user' })
  @ApiOkResponse({ description: 'Returns welcome email tracking attempts.' })
  getWelcomeEmailTracking(@Param('userId') userId: string) {
    return this.getWelcomeEmailTrackingUseCase.execute(userId)
  }

  @Post(':userId/emails/welcome-new-customer/resend-failed')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_EMAIL_RESEND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend retryable failed welcome email to one recipient' })
  @ApiOkResponse({ description: 'Returns resend result for one retryable recipient.' })
  resendFailedWelcomeEmail(@Param('userId') userId: string, @Body() dto: ResendEmailRecipientDto) {
    return this.resendFailedWelcomeEmailUseCase.execute(userId, dto.recipientEmail)
  }

  @Post()
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_CREATE)
  @ApiOperation({ summary: 'Create a Cognito account' })
  @ApiCreatedResponse({ description: 'Returns the created account.' })
  createManagedUser(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateManagedUserDto,
  ): Promise<ManagedUser> {
    return this.createManagedUserUseCase.execute(request.user!, {
      username: dto.username,
      email: dto.email,
      password: dto.password,
      name: dto.name,
      group: dto.group,
      permissions: dto.permissions,
    })
  }

  @Patch(':userId')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_UPDATE)
  @ApiOperation({ summary: 'Update a Cognito account' })
  @ApiOkResponse({ description: 'Returns the updated account.' })
  updateManagedUser(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateManagedUserDto,
  ): Promise<ManagedUser> {
    if (dto.enabled === false) {
      assertNotSelfMutation(request, userId, 'You cannot disable your own account.')
    }
    if (dto.status && dto.status !== 'ACTIVE') {
      assertNotSelfMutation(request, userId, 'You cannot block your own account.')
    }
    return this.updateManagedUserUseCase.execute(request.user!, userId, {
      email: dto.email,
      name: dto.name,
      enabled: dto.enabled,
      status: dto.status,
    })
  }

  @Patch(':userId/permissions')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_PERMISSIONS_UPDATE)
  @ApiOperation({ summary: 'Update account permissions' })
  @ApiOkResponse({ description: 'Returns the updated access record.' })
  updateUserPermissions(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserPermissionsDto,
  ): Promise<UserPermissionsRecord> {
    return this.updateUserPermissionsUseCase.execute(userId, dto.permissions, request.user!)
  }

  @Patch(':userId/password')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset a Cognito account password to a temporary password' })
  @ApiNoContentResponse({ description: 'Temporary password set.' })
  @ApiBadRequestResponse({ description: 'The password payload is invalid.' })
  resetManagedUserPassword(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: ResetManagedUserPasswordDto,
  ): Promise<void> {
    assertNotSelfMutation(request, userId, 'You cannot reset your own password from admin.')
    return this.resetManagedUserPasswordUseCase.execute(userId, dto.password)
  }

  @Delete(':userId')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_DISABLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disable a Cognito account' })
  @ApiNoContentResponse({ description: 'Account disabled.' })
  async disableManagedUser(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<void> {
    assertNotSelfMutation(request, userId, 'You cannot disable your own account.')
    await this.disableManagedUserUseCase.execute(userId, request.user)
  }

  @Get('me/profile')
  @Roles(Role.CUSTOMER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiOkResponse({ description: 'Returns the merged Cognito and application profile.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  getOwnProfile(@Req() request: AuthenticatedRequest): Promise<UserProfile> {
    return this.getOwnProfileUseCase.execute(request.user!)
  }

  @Patch('me/profile')
  @Roles(Role.CUSTOMER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiOkResponse({ description: 'Returns the updated profile.' })
  @ApiBadRequestResponse({ description: 'The profile payload is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  updateOwnProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserProfile> {
    return this.updateOwnProfileUseCase.execute(request.user!, {
      name: dto.name,
      avatarKey: dto.avatarKey,
      address: dto.address,
    })
  }

  @Post('me/password')
  @Roles(Role.CUSTOMER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a native Cognito password for the authenticated user' })
  @ApiNoContentResponse({ description: 'Password set.' })
  @ApiBadRequestResponse({ description: 'The password payload is invalid or email is unverified.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  async setOwnPassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SetOwnPasswordDto,
  ): Promise<void> {
    await this.setOwnPasswordUseCase.execute(request.user!, dto.password)
  }
}

function getRequestIpAddress(request: AuthenticatedRequest): string | undefined {
  const forwardedFor = request.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || undefined
  }

  return request.ip
}

function assertNotSelfMutation(
  request: AuthenticatedRequest,
  userId: string,
  message: string,
): void {
  if (request.user?.sub === userId) {
    throw new ForbiddenDomainError(message)
  }
}
