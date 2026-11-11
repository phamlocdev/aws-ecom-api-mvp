import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { NotFoundError } from '../../common/domain-error'
import { CATEGORY_REPOSITORY, CategoryRepositoryPort } from '../domain/category.repository.port'

@Injectable()
export class DeleteCategoryUseCase {
  constructor(
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepository: CategoryRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, categoryId: string): Promise<void> {
    const category = await this.categoryRepository.findOne(categoryId)
    if (!category) {
      throw new NotFoundError(`Category ${categoryId} was not found.`)
    }
    const deletedAt = new Date().toISOString()
    category.delete(deletedAt)
    const actor = buildUserAuditMutationContext(user, 'Category deleted')
    await this.categoryRepository.remove(categoryId, deletedAt, actor)
  }
}
