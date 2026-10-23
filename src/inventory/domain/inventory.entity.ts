import { z } from 'zod'
import { ProductStatus } from '../../products/domain/product-status.enum'

const InventoryRecordPropsSchema = z.object({
  productId: z.string(),
  availableQuantity: z.number(),
  reservedQuantity: z.number(),
  lastModifiedByType: z.string().optional(),
  lastModifiedById: z.string().optional(),
  lastModifiedByEmail: z.string().optional(),
  lastModifiedReason: z.string().optional(),
  updatedAt: z.string(),
})

type InventoryRecordProps = z.infer<typeof InventoryRecordPropsSchema>

export type CreateInventoryRecordData = Omit<InventoryRecordProps, 'updatedAt'>

export class InventoryRecord {
  readonly productId!: string
  readonly availableQuantity!: number
  readonly reservedQuantity!: number
  readonly lastModifiedByType?: string
  readonly lastModifiedById?: string
  readonly lastModifiedByEmail?: string
  readonly lastModifiedReason?: string
  readonly updatedAt!: string

  protected constructor(props: InventoryRecordProps) {
    Object.assign(this, props)
  }

  static create(data: CreateInventoryRecordData): InventoryRecord {
    return new InventoryRecord({ ...data, updatedAt: new Date().toISOString() })
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
