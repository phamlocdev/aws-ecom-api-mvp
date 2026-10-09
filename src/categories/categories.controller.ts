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
import { Category } from './category.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AuthenticatedUser } from '../auth/auth.types'
import { Public } from '../auth/public.decorator'
import { Permission } from '../auth/permissions'
import { RequirePermissions } from '../auth/permissions.decorator'
import { Role } from '../auth/roles.enum'
import { Roles } from '../auth/roles.decorator'
import { CategoriesService } from './categories.service'
import { CategoryResponseDto, PaginatedCategoryResponseDto } from './dto/category-response.dto'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { PaginationQueryDto } from '../pagination/pagination-query.dto'
import { PaginatedResponse } from '../pagination/pagination.types'
import { DtoValidationPipe } from '../validation/dto-validation.pipe'

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(@Inject(CategoriesService) private readonly categoriesService: CategoriesService) {}

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  @RequirePermissions(Permission.CATEGORIES_CREATE)
  @ApiOperation({ summary: 'Create a category with a stable categoryId slug' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({ description: 'The request body is invalid.' })
  @ApiConflictResponse({ description: 'categoryId already exists.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new DtoValidationPipe(CreateCategoryDto)) dto: CreateCategoryDto,
  ): Promise<Category> {
    return this.categoriesService.create(user, dto)
  }

  @Get()
  @Public()
  @RequirePermissions(Permission.CATEGORIES_READ)
  @ApiOperation({ summary: 'List categories' })
  @ApiOkResponse({ type: PaginatedCategoryResponseDto })
  findAll(
    @Query(new DtoValidationPipe(PaginationQueryDto)) query: PaginationQueryDto,
  ): Promise<PaginatedResponse<Category>> {
    return this.categoriesService.findAll(query)
  }

  @Get(':categoryId')
  @Public()
  @ApiOperation({ summary: 'Get one category by categoryId' })
  @ApiParam({ name: 'categoryId', example: 'electronics' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiNotFoundResponse({ description: 'Category does not exist.' })
  findOne(@Param('categoryId') categoryId: string): Promise<Category> {
    return this.categoriesService.findOne(categoryId)
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
    @Body(new DtoValidationPipe(UpdateCategoryDto)) dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.categoriesService.update(user, categoryId, dto)
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
    await this.categoriesService.remove(user, categoryId)
  }
}
