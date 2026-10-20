import { AuditMutationContext } from '../../audit/audit-actor'
import { Category } from './category.entity'

export const CATEGORY_REPOSITORY = Symbol('CATEGORY_REPOSITORY')

export interface CategoryPage {
  items: Category[]
  lastEvaluatedKey?: Record<string, unknown>
}

export interface UpdateCategoryChanges {
  name?: string
  description?: string
}

/**
 * Port implemented by the infrastructure layer. Kept free of any
 * NestJS/AWS SDK type so the application layer can depend on it directly.
 */
export interface CategoryRepositoryPort {
  /** Throws ConflictError (see domain-error.ts) if category.categoryId already exists. */
  create(category: Category): Promise<void>

  /** Returns only ACTIVE categories (soft-deleted records are excluded). */
  findAll(limit: number, startKey?: Record<string, unknown> | null): Promise<CategoryPage>

  /** Returns null if the category does not exist. Includes soft-deleted records. */
  findOne(categoryId: string): Promise<Category | null>

  /** Throws NotFoundError if the category does not exist or is already soft-deleted. */
  update(
    categoryId: string,
    changes: UpdateCategoryChanges,
    updatedAt: string,
    audit: AuditMutationContext,
  ): Promise<Category>

  /** Throws NotFoundError if the category does not exist or is already soft-deleted. */
  remove(categoryId: string, deletedAt: string, audit: AuditMutationContext): Promise<void>
}
