import { randomUUID } from 'crypto'
import { z } from 'zod'
import { ProductStatus } from './product-status.enum'

const ProductImagePropsSchema = z.object({
  key: z.string(),
  sortOrder: z.number(),
  isPrimary: z.boolean(),
  altText: z.string().optional(),
  readUrl: z.string().optional(),
  readUrlExpiresInSeconds: z.number().optional(),
})

type ProductImageProps = z.infer<typeof ProductImagePropsSchema>

export class ProductImage {
  readonly key!: string
  readonly sortOrder!: number
  readonly isPrimary!: boolean
  readonly altText?: string
  readonly readUrl?: string
  readonly readUrlExpiresInSeconds?: number

  private constructor(props: ProductImageProps) {
    Object.assign(this, props)
  }

  static create(data: ProductImageProps): ProductImage {
    return new ProductImage(data)
  }

  static fromRecord(item: Record<string, unknown>): ProductImage {
    return new ProductImage(ProductImagePropsSchema.parse(item))
  }
}

const ProductPropsSchema = z.object({
  productId: z.string(),
  name: z.string(),
  description: z.string(),
  categoryId: z.string(),
  price: z.number(),
  currency: z.literal('VND'),
  imageUrl: z.string().optional(),
  images: z.array(ProductImagePropsSchema).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']),
  deletedAt: z.string().optional(),
  lastModifiedByType: z.string().optional(),
  lastModifiedById: z.string().optional(),
  lastModifiedByEmail: z.string().optional(),
  lastModifiedReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type ProductProps = {
  productId: string
  name: string
  description: string
  categoryId: string
  price: number
  currency: 'VND'
  imageUrl?: string
  images?: ProductImage[]
  status: ProductStatus
  deletedAt?: string
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
  createdAt: string
  updatedAt: string
}

export type CreateProductData = {
  name: string
  description: string
  categoryId: string
  price: number
  currency?: 'VND'
  imageUrl?: string
  images?: ProductImage[]
  status?: ProductStatus
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
}

export class Product {
  readonly productId!: string
  readonly name!: string
  readonly description!: string
  readonly categoryId!: string
  readonly price!: number
  readonly currency!: 'VND'
  readonly imageUrl?: string
  readonly images?: ProductImage[]
  readonly status!: ProductStatus
  readonly deletedAt?: string
  readonly lastModifiedByType?: string
  readonly lastModifiedById?: string
  readonly lastModifiedByEmail?: string
  readonly lastModifiedReason?: string
  readonly createdAt!: string
  readonly updatedAt!: string

  private constructor(props: ProductProps) {
    Object.assign(this, props)
  }

  static create({ status, ...rest }: CreateProductData): Product {
    const timestamp = new Date().toISOString()
    return new Product({
      productId: randomUUID(),
      currency: 'VND',
      status: status ?? ProductStatus.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...rest,
    })
  }

  static fromRecord(item: Record<string, unknown>): Product {
    const parsed = ProductPropsSchema.parse(item)
    return new Product({
      ...parsed,
      status: parsed.status as ProductStatus,
      images: parsed.images?.map(img => ProductImage.create(img)),
    })
  }

  get isActive(): boolean {
    return this.status === ProductStatus.ACTIVE
  }

  get isDeleted(): boolean {
    return this.status === ProductStatus.DELETED
  }
}
