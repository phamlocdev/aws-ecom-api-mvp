import { Inject, Injectable } from '@nestjs/common'
import { PaginationQueryDto } from '../../pagination/pagination-query.dto'
import { PaginatedResponse } from '../../pagination/pagination.types'
import { resolvePaginationState, toPaginatedResponse } from '../../pagination/pagination.util'
import { CATEGORY_REPOSITORY, CategoryRepositoryPort } from '../domain/category.repository.port'
import { Category } from '../domain/category.entity'

@Injectable()
export class FindAllCategoriesUseCase {
  constructor(
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepository: CategoryRepositoryPort,
  ) {}

  async execute(query: PaginationQueryDto): Promise<PaginatedResponse<Category>> {
    const pagination = resolvePaginationState('categories', query)
    const page = await this.categoryRepository.findAll(pagination.limit, pagination.startKey)
    return toPaginatedResponse('categories', pagination, page.items, page.lastEvaluatedKey)
  }
}
