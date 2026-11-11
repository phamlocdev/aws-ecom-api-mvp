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
import { Role } from '../../auth/roles.enum'
import { Roles } from '../../auth/roles.decorator'
import { Permission } from '../../auth/permissions'
import { RequirePermissions } from '../../auth/permissions.decorator'
import { CurrentUser } from '../../auth/current-user.decorator'
import { AuthenticatedUser } from '../../auth/auth.types'
import { PaginatedResponse } from '../../pagination/pagination.types'
import { InventorySummary } from '../domain/inventory.entity'
import { FindAllInventoriesUseCase } from '../application/find-all-inventories.use-case'
import { FindOneInventoryUseCase } from '../application/find-one-inventory.use-case'
import { UpdateInventoryQuantityUseCase } from '../application/update-inventory-quantity.use-case'
import { InventoryResponseDto, PaginatedInventoryResponseDto } from './dto/inventory-response.dto'
import { ListInventoriesQueryDto } from './dto/list-inventories-query.dto'
import { UpdateInventoryDto } from './dto/update-inventory.dto'

@ApiTags('inventories')
@Controller('inventories')
export class InventoryController {
  constructor(
    @Inject(FindAllInventoriesUseCase)
    private readonly findAllInventoriesUseCase: FindAllInventoriesUseCase,
    @Inject(FindOneInventoryUseCase)
    private readonly findOneInventoryUseCase: FindOneInventoryUseCase,
    @Inject(UpdateInventoryQuantityUseCase)
    private readonly updateInventoryQuantityUseCase: UpdateInventoryQuantityUseCase,
  ) {}

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
  findAll(@Query() query: ListInventoriesQueryDto): Promise<PaginatedResponse<InventorySummary>> {
    return this.findAllInventoriesUseCase.execute({
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
      status: query.status,
      productIds: query.productIds,
    })
  }

  @Get(':productId')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.INVENTORIES_READ)
  @ApiOperation({ summary: 'Get inventory for one product' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: InventoryResponseDto })
  @ApiNotFoundResponse({ description: 'Product does not exist.' })
  findOne(@Param('productId') productId: string): Promise<InventorySummary> {
    return this.findOneInventoryUseCase.execute(productId)
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
    @Body() dto: UpdateInventoryDto,
  ): Promise<InventorySummary> {
    return this.updateInventoryQuantityUseCase.execute(user, productId, dto.availableQuantity)
  }
}
