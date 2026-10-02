import { ProductStatus } from '../products/product-status.enum'

export interface InventoryRecord {
  productId: string
  availableQuantity: number
  reservedQuantity: number
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
  updatedAt: string
}

export interface InventorySummary extends InventoryRecord {
  productName: string
  categoryId: string
  imageUrl?: string
  productStatus: ProductStatus
}

export interface ReservedInventoryItem {
  productId: string
  quantity: number
}
