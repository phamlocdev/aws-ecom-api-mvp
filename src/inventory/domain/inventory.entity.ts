import { z } from 'zod'
import { ProductStatus } from '../../products/domain/product-status.enum'
import { ConflictError, InvalidInputError } from '../../common/domain-error'
import { BaseEntity } from '../../common/base.entity'

const InventoryRecordPropsSchema = z.object({
  productId: z.string(),
  availableQuantity: z.number(),
  reservedQuantity: z.number(),
  createdAt: z.string(),
  lastModifiedByType: z.string().optional(),
  lastModifiedById: z.string().optional(),
  lastModifiedByEmail: z.string().optional(),
  lastModifiedReason: z.string().optional(),
  updatedAt: z.string(),
})

type InventoryRecordProps = z.infer<typeof InventoryRecordPropsSchema>

export type CreateInventoryRecordData = Omit<InventoryRecordProps, 'updatedAt' | 'createdAt'> & {
  createdAt?: string
}

export class InventoryRecord extends BaseEntity<InventoryRecordProps> {
  readonly productId!: string
  readonly availableQuantity!: number
  readonly reservedQuantity!: number

  protected constructor(props: InventoryRecordProps) {
    super()
    Object.assign(this, props)
  }

  static create(data: CreateInventoryRecordData): InventoryRecord {
    const timestamp = new Date().toISOString()
    return new InventoryRecord({ createdAt: timestamp, ...data, updatedAt: timestamp })
  }

  static fromRecord(item: Record<string, unknown>): InventoryRecord {
    return new InventoryRecord(InventoryRecordPropsSchema.parse(item))
  }

  get isOutOfStock(): boolean {
    return this.availableQuantity <= 0
  }

  get totalQuantity(): number {
    return this.availableQuantity + this.reservedQuantity
  }

  reserve(quantity: number): this {
    if (quantity <= 0) throw new InvalidInputError('Quantity must be positive')
    if (this.availableQuantity < quantity) {
      throw new ConflictError(
        `Insufficient inventory: need ${quantity}, available ${this.availableQuantity}`,
      )
    }
    return this.with({
      availableQuantity: this.availableQuantity - quantity,
      reservedQuantity: this.reservedQuantity + quantity,
      updatedAt: new Date().toISOString(),
    })
  }

  release(quantity: number): this {
    if (quantity <= 0) throw new InvalidInputError('Quantity must be positive')
    return this.with({
      availableQuantity: this.availableQuantity + quantity,
      reservedQuantity: Math.max(0, this.reservedQuantity - quantity),
      updatedAt: new Date().toISOString(),
    })
  }
}

type InventorySummaryProps = InventoryRecordProps & {
  productName: string
  categoryId: string
  imageUrl?: string
  productStatus: ProductStatus
}

export class InventorySummary extends InventoryRecord {
  readonly productName!: string
  readonly categoryId!: string
  readonly imageUrl?: string
  readonly productStatus!: ProductStatus

  private constructor(props: InventorySummaryProps) {
    super(props)
    this.productName = props.productName
    this.categoryId = props.categoryId
    this.imageUrl = props.imageUrl
    this.productStatus = props.productStatus
  }

  static fromParts(
    inventory: InventoryRecord,
    product: { name: string; categoryId: string; imageUrl?: string; status: ProductStatus },
  ): InventorySummary {
    return new InventorySummary({
      ...(inventory as unknown as InventoryRecordProps),
      productName: product.name,
      categoryId: product.categoryId,
      imageUrl: product.imageUrl,
      productStatus: product.status,
    })
  }
}

export interface ReservedInventoryItem {
  productId: string
  quantity: number
}
