import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { CATEGORY_REPOSITORY, CategoryRepositoryPort } from '../domain/category.repository.port'

@Injectable()
export class DeleteCategoryUseCase {
  constructor(
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepository: CategoryRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, categoryId: string): Promise<void> {
    const timestamp = new Date().toISOString()
    const actor = buildUserAuditMutationContext(user, 'Category deleted')
    await this.categoryRepository.remove(categoryId, timestamp, actor)
  }
}
