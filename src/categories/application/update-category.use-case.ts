import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { InvalidInputError } from '../../common/domain-error'
import {
  CATEGORY_REPOSITORY,
  CategoryRepositoryPort,
  UpdateCategoryChanges,
} from '../domain/category.repository.port'
import { Category } from '../domain/category.entity'

@Injectable()
export class UpdateCategoryUseCase {
  constructor(
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepository: CategoryRepositoryPort,
  ) {}

  async execute(
    user: AuthenticatedUser,
    categoryId: string,
    changes: UpdateCategoryChanges,
  ): Promise<Category> {
    const mutableFields = Object.entries(changes).filter(([, value]) => value !== undefined)
    if (mutableFields.length === 0) {
      throw new InvalidInputError('Provide at least one category field to update.')
    }

    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Category updated')
    return this.categoryRepository.update(categoryId, changes, timestamp, actor)
  }
}
