import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext, toAuditMutationAttributes } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CATEGORY_REPOSITORY, CategoryRepositoryPort } from '../domain/category.repository.port'
import { Category } from '../domain/category.entity'

export interface CreateCategoryInput {
  categoryId: string
  name: string
  description?: string
}

@Injectable()
export class CreateCategoryUseCase {
  constructor(
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepository: CategoryRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, input: CreateCategoryInput): Promise<Category> {
    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Category created')
    const category: Category = {
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...toAuditMutationAttributes(actor),
    }

    await this.categoryRepository.create(category)
    return category
  }
}
