import { Controller, Get, Inject, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Permission } from '../auth/permissions'
import { RequirePermissions } from '../auth/permissions.decorator'
import { Role } from '../auth/roles.enum'
import { Roles } from '../auth/roles.decorator'
import { AuditLogQueryResult, AuditLogService } from './audit-log.service'

@ApiTags('audit')
@Controller('audit')
export class AuditLogController {
  constructor(@Inject(AuditLogService) private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({ summary: 'Get audit entries for one entity' })
  @ApiQuery({ name: 'entityType', enum: ['ORDER', 'PRODUCT', 'CATEGORY', 'INVENTORY', 'USER_ACCOUNT'] })
  @ApiQuery({ name: 'entityId' })
  @ApiOkResponse({ description: 'Returns audit entries for an exact entity identity.' })
  findByEntity(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<AuditLogQueryResult> {
    return this.auditLogService.findByEntity({
      entityType,
      entityId,
      limit: limit ? Number(limit) : undefined,
      cursor,
    })
  }
}
