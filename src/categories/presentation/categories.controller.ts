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
  ApiTags,
} from '@nestjs/swagger'
import { Category } from '../domain/category.entity'
import { CurrentUser } from '../../auth/current-user.decorator'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Public } from '../../auth/public.decorator'
import { Permission } from '../../auth/permissions'
import { RequirePermissions } from '../../auth/permissions.decorator'
import { Role } from '../../auth/roles.enum'
import { Roles } from '../../auth/roles.decorator'
import { CreateCategoryUseCase } from '../application/create-category.use-case'
import { FindAllCategoriesUseCase } from '../application/find-all-categories.use-case'
import { FindOneCategoryUseCase } from '../application/find-one-category.use-case'
import { UpdateCategoryUseCase } from '../application/update-category.use-case'
import { DeleteCategoryUseCase } from '../application/delete-category.use-case'
import { CategoryResponseDto, PaginatedCategoryResponseDto } from './dto/category-response.dto'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { PaginationQueryDto } from '../../pagination/pagination-query.dto'
import { PaginatedResponse } from '../../pagination/pagination.types'

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    @Inject(CreateCategoryUseCase) private readonly createCategoryUseCase: CreateCategoryUseCase,
    @Inject(FindAllCategoriesUseCase)
    private readonly findAllCategoriesUseCase: FindAllCategoriesUseCase,
    @Inject(FindOneCategoryUseCase)
    private readonly findOneCategoryUseCase: FindOneCategoryUseCase,
    @Inject(UpdateCategoryUseCase) private readonly updateCategoryUseCase: UpdateCategoryUseCase,
    @Inject(DeleteCategoryUseCase) private readonly deleteCategoryUseCase: DeleteCategoryUseCase,
  ) {}

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.CATEGORIES_CREATE)
  @ApiOperation({ summary: 'Create a category with a stable categoryId slug' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({ description: 'The request body is invalid.' })
  @ApiConflictResponse({ description: 'categoryId already exists.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<Category> {
    return this.createCategoryUseCase.execute(user, {
      categoryId: dto.categoryId,
      name: dto.name,
      description: dto.description,
    })
  }

  @Get()
  @Public()
  @RequirePermissions(Permission.CATEGORIES_READ)
  @ApiOperation({ summary: 'List categories' })
  @ApiOkResponse({ type: PaginatedCategoryResponseDto })
  findAll(@Query() query: PaginationQueryDto): Promise<PaginatedResponse<Category>> {
    return this.findAllCategoriesUseCase.execute(query)
  }

  @Get(':categoryId')
  @Public()
  @ApiOperation({ summary: 'Get one category by categoryId' })
  @ApiParam({ name: 'categoryId', example: 'electronics' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiNotFoundResponse({ description: 'Category does not exist.' })
  findOne(@Param('categoryId') categoryId: string): Promise<Category> {
    return this.findOneCategoryUseCase.execute(categoryId)
  }

  @Patch(':categoryId')
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.CATEGORIES_UPDATE)
  @ApiOperation({ summary: 'Update category name or description' })
  @ApiParam({ name: 'categoryId', example: 'electronics' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({ description: 'No mutable fields or invalid input.' })
  @ApiNotFoundResponse({ description: 'Category does not exist.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.updateCategoryUseCase.execute(user, categoryId, {
      name: dto.name,
      description: dto.description,
    })
  }

  @Delete(':categoryId')
  @Roles(Role.ADMIN)
  @RequirePermissions(Permission.CATEGORIES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category',
    description: 'This does not update Products that still reference this categoryId.',
  })
  @ApiParam({ name: 'categoryId', example: 'electronics' })
  @ApiNoContentResponse({ description: 'Category deleted.' })
  @ApiNotFoundResponse({ description: 'Category does not exist.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId') categoryId: string,
  ): Promise<void> {
    await this.deleteCategoryUseCase.execute(user, categoryId)
  }
}
