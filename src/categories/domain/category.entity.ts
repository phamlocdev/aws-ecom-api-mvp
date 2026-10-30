import { z } from 'zod'
import { InvalidInputError } from '../../common/domain-error'
import { BaseEntity } from '../../common/base.entity'

const CategoryPropsSchema = z.object({
  categoryId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'DELETED']).default('ACTIVE'),
  deletedAt: z.string().optional(),
  lastModifiedByType: z.string().optional(),
  lastModifiedById: z.string().optional(),
  lastModifiedByEmail: z.string().optional(),
  lastModifiedReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type CategoryProps = z.infer<typeof CategoryPropsSchema>

export type CreateCategoryData = {
  categoryId: string
  name: string
  description?: string
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
}

export class Category extends BaseEntity<CategoryProps> {
  readonly categoryId!: string
  readonly name!: string
  readonly description?: string
  readonly status!: 'ACTIVE' | 'DELETED'
  readonly deletedAt?: string

  private constructor(props: CategoryProps) {
    super()
    Object.assign(this, props)
  }

  static create(data: CreateCategoryData): Category {
    const timestamp = new Date().toISOString()
    return new Category({
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...data,
    })
  }

  static fromRecord(item: Record<string, unknown>): Category {
    return new Category(CategoryPropsSchema.parse(item))
  }

  get isActive(): boolean {
    return this.status === 'ACTIVE'
  }

  get isDeleted(): boolean {
    return this.status === 'DELETED'
  }

  delete(deletedAt: string): this {
    if (!this.isActive) {
      throw new InvalidInputError(`Category ${this.categoryId} is not active.`)
    }
    return this.with({ status: 'DELETED' as const, deletedAt, updatedAt: deletedAt })
  }
}
