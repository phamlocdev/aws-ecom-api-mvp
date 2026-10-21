import { AuditMutationContext } from '../../audit/audit-actor'
import { ProductStatus } from '../../products/domain/product-status.enum'
import { InventoryRecord, InventorySummary, ReservedInventoryItem } from './inventory.entity'

export const INVENTORY_REPOSITORY = Symbol('INVENTORY_REPOSITORY')

export interface InventoryFilters {
  q?: string
  status?: ProductStatus
}

export interface InventorySummaryPage {
  items: InventorySummary[]
  lastEvaluatedKey?: Record<string, unknown>
  scannedCount: number
}

/**
 * Port implemented by the infrastructure layer. Kept free of any
 * NestJS/AWS SDK type so the application layer can depend on it directly.
 *
 * Inventory rows are joined with product metadata (name/category/image/status)
 * to produce an InventorySummary, so this adapter reads both the inventory
 * and products tables.
 */
export interface InventoryRepositoryPort {
  /** Creates a zeroed inventory record if one does not already exist for productId. */
  ensureRecord(productId: string): Promise<InventoryRecord>

  findOne(productId: string): Promise<InventoryRecord | null>

  /** Throws NotFoundError if the product does not exist. */
  findOneSummary(productId: string): Promise<InventorySummary>

  /** Products that no longer exist are silently dropped from the result. */
  findSummariesByProductIds(productIds: string[]): Promise<InventorySummary[]>

  findAllSummaries(
    filters: InventoryFilters,
    limit: number,
    startKey?: Record<string, unknown> | null,
  ): Promise<InventorySummaryPage>

  /** Throws NotFoundError if the product does not exist. */
  updateAvailableQuantity(
    productId: string,
    availableQuantity: number,
    updatedAt: string,
    audit: AuditMutationContext,
  ): Promise<InventorySummary>

  /** Throws ConflictError if there is not enough availableQuantity. */
  reserve(productId: string, quantity: number, audit: AuditMutationContext): Promise<void>

  release(items: ReservedInventoryItem[], audit: AuditMutationContext): Promise<void>
}
