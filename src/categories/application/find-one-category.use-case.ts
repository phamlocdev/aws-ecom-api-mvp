import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '../../common/domain-error'
import { CATEGORY_REPOSITORY, CategoryRepositoryPort } from '../domain/category.repository.port'
import { Category } from '../domain/category.entity'

@Injectable()
export class FindOneCategoryUseCase {
  constructor(
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepository: CategoryRepositoryPort,
  ) {}

  async execute(categoryId: string): Promise<Category> {
    const category = await this.categoryRepository.findOne(categoryId)
    if (!category || category.status === 'DELETED') {
      throw new NotFoundError(`Category ${categoryId} was not found.`)
    }
    return category
  }
}
