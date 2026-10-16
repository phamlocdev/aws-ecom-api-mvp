import { ProductStatus } from './product-status.enum'

export interface ProductImage {
  key: string
  sortOrder: number
  isPrimary: boolean
  altText?: string
  readUrl?: string
  readUrlExpiresInSeconds?: number
}

export interface ProductCategorySummary {
  categoryId: string
  name: string
}

export interface Product {
  productId: string
  name: string
  description: string
  categoryId: string
  category?: ProductCategorySummary
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
