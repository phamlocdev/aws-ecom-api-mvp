import { Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'
import { Role } from '../auth/roles.enum'
import { Roles } from '../auth/roles.decorator'
import { Permission } from '../auth/permissions'
import { RequirePermissions } from '../auth/permissions.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import { AuthenticatedUser } from '../auth/auth.types'
import { PaginatedResponse } from '../pagination/pagination.types'
import { DtoValidationPipe } from '../validation/dto-validation.pipe'
import { InventoryService } from './inventory.service'
import { InventorySummary } from './inventory.types'
import { InventoryResponseDto, PaginatedInventoryResponseDto } from './dto/inventory-response.dto'
import { ListInventoriesQueryDto } from './dto/list-inventories-query.dto'
import { UpdateInventoryDto } from './dto/update-inventory.dto'

@ApiTags('inventories')
@Controller('inventories')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.INVENTORIES_READ)
  @ApiOperation({
    summary: 'List inventory rows joined with product metadata',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Case-sensitive substring search across product name, description, or productId.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'INACTIVE'],
    description: 'Return only inventory rows for products with this status.',
  })
  @ApiQuery({
    name: 'productIds',
    required: false,
    isArray: true,
    type: String,
    description: 'Optional comma-separated list of product IDs for batched inventory summaries.',
  })
  @ApiOkResponse({ type: PaginatedInventoryResponseDto })
  findAll(
    @Query(new DtoValidationPipe(ListInventoriesQueryDto)) query: ListInventoriesQueryDto,
  ): Promise<PaginatedResponse<InventorySummary>> {
    return this.inventoryService.findAll(query)
  }

  @Get(':productId')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.INVENTORIES_READ)
  @ApiOperation({ summary: 'Get inventory for one product' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: InventoryResponseDto })
  @ApiNotFoundResponse({ description: 'Product does not exist.' })
  findOne(@Param('productId') productId: string): Promise<InventorySummary> {
    return this.inventoryService.findOneSummary(productId)
  }

  @Patch(':productId')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.INVENTORIES_UPDATE)
  @ApiOperation({ summary: 'Set the available quantity for one product' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: InventoryResponseDto })
  @ApiBadRequestResponse({ description: 'Quantity must be a non-negative integer.' })
  @ApiNotFoundResponse({ description: 'Product does not exist.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
    @Body(new DtoValidationPipe(UpdateInventoryDto)) dto: UpdateInventoryDto,
  ): Promise<InventorySummary> {
    return this.inventoryService.updateAvailableQuantity(user, productId, dto.availableQuantity)
  }
}
