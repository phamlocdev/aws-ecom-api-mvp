import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { AuthenticatedRequest } from '../auth/auth.types'
import { Permission } from '../auth/permissions'
import { RequirePermissions } from '../auth/permissions.decorator'
import { Role } from '../auth/roles.enum'
import { Roles } from '../auth/roles.decorator'
import { EmailStatisticsQueryDto } from '../mail/dto/email-statistics-query.dto'
import { ResendEmailRecipientDto } from '../mail/dto/resend-email-recipient.dto'
import { EmailDeliveryStatistics } from '../mail/mail.types'
import { DtoValidationPipe } from '../validation/dto-validation.pipe'
import { CreateManagedUserDto } from './dto/create-managed-user.dto'
import { ResetManagedUserPasswordDto } from './dto/reset-managed-user-password.dto'
import { SetOwnPasswordDto } from './dto/set-own-password.dto'
import { UpdateManagedUserDto } from './dto/update-managed-user.dto'
import { UpdateUserProfileDto } from './dto/update-user-profile.dto'
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto'
import { UsersService } from './users.service'
import { ManagedUser, UserPermissionsRecord, UserProfile } from './user.types'

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_READ)
  @ApiOperation({ summary: 'List Cognito users with their groups' })
  @ApiOkResponse({ description: 'Returns all Cognito users and their current roles.' })
  findAll(
    @Req() request: AuthenticatedRequest,
    @Query(new DtoValidationPipe(EmailStatisticsQueryDto)) query: EmailStatisticsQueryDto,
  ): Promise<ManagedUser[] | EmailDeliveryStatistics> {
    if (query.emailStatistics === 'true') {
      if (!request.user?.groups.includes(Role.ADMIN)) {
        throw new ForbiddenException('You do not have permission to view email statistics.')
      }
      return this.usersService.getWelcomeEmailStatistics()
    }

    return this.usersService.findAll()
  }

  @Get('email-statistics')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_EMAIL_READ)
  @ApiOperation({ summary: 'Get welcome email delivery statistics' })
  @ApiOkResponse({ description: 'Returns counts by welcome email delivery status.' })
  getWelcomeEmailStatistics() {
    return this.usersService.getWelcomeEmailStatistics()
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
    return this.usersService.findLoginAudit({
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
    return this.usersService.recordLoginContext(request.user!, {
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
    return this.usersService.getWelcomeEmailTracking(userId)
  }

  @Post(':userId/emails/welcome-new-customer/resend-failed')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_EMAIL_RESEND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend retryable failed welcome email to one recipient' })
  @ApiOkResponse({ description: 'Returns resend result for one retryable recipient.' })
  resendFailedWelcomeEmail(
    @Param('userId') userId: string,
    @Body(new DtoValidationPipe(ResendEmailRecipientDto)) dto: ResendEmailRecipientDto,
  ) {
    return this.usersService.resendFailedWelcomeEmail(userId, dto.recipientEmail)
  }

  @Post()
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_CREATE)
  @ApiOperation({ summary: 'Create a Cognito account' })
  @ApiCreatedResponse({ description: 'Returns the created account.' })
  createManagedUser(
    @Req() request: AuthenticatedRequest,
    @Body(new DtoValidationPipe(CreateManagedUserDto)) dto: CreateManagedUserDto,
  ): Promise<ManagedUser> {
    return this.usersService.createManagedUser(request.user!, dto)
  }

  @Patch(':userId')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_UPDATE)
  @ApiOperation({ summary: 'Update a Cognito account' })
  @ApiOkResponse({ description: 'Returns the updated account.' })
  updateManagedUser(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body(new DtoValidationPipe(UpdateManagedUserDto)) dto: UpdateManagedUserDto,
  ): Promise<ManagedUser> {
    if (dto.enabled === false) {
      assertNotSelfMutation(request, userId, 'You cannot disable your own account.')
    }
    if (dto.status && dto.status !== 'ACTIVE') {
      assertNotSelfMutation(request, userId, 'You cannot block your own account.')
    }
    return this.usersService.updateManagedUser(request.user!, userId, dto)
  }

  @Patch(':userId/permissions')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.USERS_PERMISSIONS_UPDATE)
  @ApiOperation({ summary: 'Update account permissions' })
  @ApiOkResponse({ description: 'Returns the updated access record.' })
  updateUserPermissions(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body(new DtoValidationPipe(UpdateUserPermissionsDto)) dto: UpdateUserPermissionsDto,
  ): Promise<UserPermissionsRecord> {
    return this.usersService.updateUserPermissions(userId, dto.permissions, request.user!)
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
    @Body(new DtoValidationPipe(ResetManagedUserPasswordDto)) dto: ResetManagedUserPasswordDto,
  ): Promise<void> {
    assertNotSelfMutation(request, userId, 'You cannot reset your own password from admin.')
    return this.usersService.resetManagedUserPassword(userId, dto.password)
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
    await this.usersService.disableManagedUser(userId, request.user!)
  }

  @Get('me/profile')
  @Roles(Role.CUSTOMER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiOkResponse({ description: 'Returns the merged Cognito and application profile.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  getOwnProfile(@Req() request: AuthenticatedRequest): Promise<UserProfile> {
    return this.usersService.getOwnProfile(request.user!)
  }

  @Patch('me/profile')
  @Roles(Role.CUSTOMER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiOkResponse({ description: 'Returns the updated profile.' })
  @ApiBadRequestResponse({ description: 'The profile payload is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  updateOwnProfile(
    @Req() request: AuthenticatedRequest,
    @Body(new DtoValidationPipe(UpdateUserProfileDto)) dto: UpdateUserProfileDto,
  ): Promise<UserProfile> {
    return this.usersService.updateOwnProfile(request.user!, dto)
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
    @Body(new DtoValidationPipe(SetOwnPasswordDto)) dto: SetOwnPasswordDto,
  ): Promise<void> {
    await this.usersService.setOwnPassword(request.user!, dto.password)
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
    throw new ForbiddenException(message)
  }
}
