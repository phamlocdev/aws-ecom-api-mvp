import { AuditMutationContext } from '../../audit/audit-actor'
import { Product } from './product.entity'
import { ProductStatus } from './product-status.enum'

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY')

export interface ProductPage {
  items: Product[]
  lastEvaluatedKey?: Record<string, unknown>
  scannedCount: number
}

export interface ProductFilters {
  categoryId?: string
  status?: ProductStatus
  minPrice?: number
  maxPrice?: number
  updatedFrom?: string
  updatedTo?: string
  q?: string
}

export interface InitialProductInventory {
  productId: string
  availableQuantity: number
  reservedQuantity: number
  updatedAt: string
  lastModifiedByType: string
  lastModifiedById: string
  lastModifiedByEmail: string
  lastModifiedReason: string
}

/**
 * Port implemented by the infrastructure layer. Kept free of any
 * NestJS/AWS SDK type so the application layer can depend on it directly.
 */
export interface ProductRepositoryPort {
  /**
   * Writes the product and its initial inventory row atomically (DynamoDB
   * transaction spanning the products and inventory tables). Throws
   * ConflictError if product.productId already exists.
   */
  create(product: Product, initialInventory: InitialProductInventory): Promise<void>

  /**
   * Returns up to `limit` items matching the given filters. Soft-deleted
   * products (status DELETED) are always excluded by this query-layer filter.
   */
  findAll(
    filters: ProductFilters,
    limit: number,
    startKey?: Record<string, unknown> | null,
  ): Promise<ProductPage>

  /** Returns null if the product does not exist. Includes soft-deleted records. */
  findOne(productId: string): Promise<Product | null>

  /** Throws NotFoundError if the product does not exist or is already soft-deleted. */
  update(
    productId: string,
    changes: Partial<Product>,
    updatedAt: string,
    audit: AuditMutationContext,
  ): Promise<Product>

  /** Throws NotFoundError if the product does not exist or is already soft-deleted. */
  remove(productId: string, deletedAt: string, audit: AuditMutationContext): Promise<void>
}
