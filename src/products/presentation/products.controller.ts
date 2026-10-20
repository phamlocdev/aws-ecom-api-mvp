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
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../../auth/current-user.decorator'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Public } from '../../auth/public.decorator'
import { Permission } from '../../auth/permissions'
import { RequirePermissions } from '../../auth/permissions.decorator'
import { Role } from '../../auth/roles.enum'
import { Roles } from '../../auth/roles.decorator'
import { PaginatedResponse } from '../../pagination/pagination.types'
import { Product } from '../domain/product.entity'
import { CreateProductUseCase } from '../application/create-product.use-case'
import { FindAllProductsUseCase } from '../application/find-all-products.use-case'
import { FindProductForResponseUseCase } from '../application/find-product-for-response.use-case'
import { UpdateProductUseCase } from '../application/update-product.use-case'
import { DeleteProductUseCase } from '../application/delete-product.use-case'
import { CreateProductDto } from './dto/create-product.dto'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import { PaginatedProductResponseDto, ProductResponseDto } from './dto/product-response.dto'
import { UpdateProductDto } from './dto/update-product.dto'

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    @Inject(CreateProductUseCase) private readonly createProductUseCase: CreateProductUseCase,
    @Inject(FindAllProductsUseCase)
    private readonly findAllProductsUseCase: FindAllProductsUseCase,
    @Inject(FindProductForResponseUseCase)
    private readonly findProductForResponseUseCase: FindProductForResponseUseCase,
    @Inject(UpdateProductUseCase) private readonly updateProductUseCase: UpdateProductUseCase,
    @Inject(DeleteProductUseCase) private readonly deleteProductUseCase: DeleteProductUseCase,
  ) {}

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.PRODUCTS_CREATE)
  @ApiOperation({ summary: 'Create a product' })
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({ description: 'The request body is invalid.' })
  @ApiConflictResponse({ description: 'Generated ID already exists.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ): Promise<Product> {
    return this.createProductUseCase.execute(user, {
      name: dto.name,
      description: dto.description,
      categoryId: dto.categoryId,
      price: dto.price,
      availableQuantity: dto.availableQuantity,
      imageUrl: dto.imageUrl,
      images: dto.images,
      status: dto.status,
    })
  }

  @Get()
  @Public()
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({
    summary: 'List products',
    description:
      'Uses DynamoDB Scan with cursor pagination and optional product filters. No GSI or order is guaranteed.',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    description: 'Return only products that reference this categoryId.',
    example: 'electronics',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'INACTIVE'],
    description: 'Return only products with this status.',
  })
  @ApiQuery({
    name: 'minPrice',
    required: false,
    type: Number,
    description: 'Minimum product price in VND.',
  })
  @ApiQuery({
    name: 'maxPrice',
    required: false,
    type: Number,
    description: 'Maximum product price in VND.',
  })
  @ApiQuery({
    name: 'updatedFrom',
    required: false,
    description: 'Return products updated at or after this ISO timestamp.',
  })
  @ApiQuery({
    name: 'updatedTo',
    required: false,
    description: 'Return products updated at or before this ISO timestamp.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Case-sensitive substring search across product name and description.',
  })
  @ApiOkResponse({ type: PaginatedProductResponseDto })
  findAll(@Query() query: ListProductsQueryDto): Promise<PaginatedResponse<Product>> {
    return this.findAllProductsUseCase.execute(query)
  }

  @Get(':productId')
  @Public()
  @ApiOperation({ summary: 'Get one product by its primary key' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product does not exist.' })
  findOne(@Param('productId') productId: string): Promise<Product> {
    return this.findProductForResponseUseCase.execute(productId)
  }

  @Patch(':productId')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update one or more mutable product fields' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiBadRequestResponse({ description: 'No mutable fields or invalid input.' })
  @ApiNotFoundResponse({ description: 'Product does not exist.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    return this.updateProductUseCase.execute(user, productId, {
      name: dto.name,
      description: dto.description,
      categoryId: dto.categoryId,
      price: dto.price,
      imageUrl: dto.imageUrl,
      images: dto.images,
      status: dto.status,
    })
  }

  @Delete(':productId')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.PRODUCTS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product' })
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Product deleted.' })
  @ApiNotFoundResponse({ description: 'Product does not exist.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
  ): Promise<void> {
    await this.deleteProductUseCase.execute(user, productId)
  }
}
