import { z } from 'zod'

const CategoryPropsSchema = z.object({
  categoryId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'DELETED']),
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

export class Category {
  readonly categoryId!: string
  readonly name!: string
  readonly description?: string
  readonly status!: 'ACTIVE' | 'DELETED'
  readonly deletedAt?: string
  readonly lastModifiedByType?: string
  readonly lastModifiedById?: string
  readonly lastModifiedByEmail?: string
  readonly lastModifiedReason?: string
  readonly createdAt!: string
  readonly updatedAt!: string

  private constructor(props: CategoryProps) {
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

  static fromRecordV2(item: Record<string, unknown>): Category {
    return new Category({
      categoryId: item['categoryId'] as string,
      name: item['name'] as string,
      description: item['description'] as string | undefined,
      status: item['status'] as 'ACTIVE' | 'DELETED',
      deletedAt: item['deletedAt'] as string | undefined,
      lastModifiedByType: item['lastModifiedByType'] as string | undefined,
      lastModifiedById: item['lastModifiedById'] as string | undefined,
      lastModifiedByEmail: item['lastModifiedByEmail'] as string | undefined,
      lastModifiedReason: item['lastModifiedReason'] as string | undefined,
      createdAt: item['createdAt'] as string,
      updatedAt: item['updatedAt'] as string,
    })
  }

  get isActive(): boolean {
    return this.status === 'ACTIVE'
  }

  get isDeleted(): boolean {
    return this.status === 'DELETED'
  }
}
