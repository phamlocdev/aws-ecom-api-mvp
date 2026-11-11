import { z } from 'zod'

export type OrderItemPatch = {
  unitPrice?: number
  quantity?: number
  productName?: string
  imageUrl?: string
}

const OrderItemPropsSchema = z.object({
  orderId: z.string(),
  lineId: z.string(),
  productId: z.string(),
  productName: z.string(),
  imageUrl: z.string().optional(),
  unitPrice: z.number(),
  quantity: z.number(),
  lineTotal: z.number(),
  createdAt: z.string(),
})

export type CreateOrderItemData = {
  orderId: string
  lineId: string
  productId: string
  productName: string
  imageUrl?: string
  unitPrice: number
  quantity: number
  lineTotal: number
  createdAt: string
}

export class OrderItem {
  readonly orderId!: string
  readonly lineId!: string
  readonly productId!: string
  readonly productName!: string
  readonly imageUrl?: string
  readonly unitPrice!: number
  readonly quantity!: number
  readonly lineTotal!: number
  readonly createdAt!: string

  private constructor(props: CreateOrderItemData) {
    Object.assign(this, props)
  }

  toRecord(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries({
        orderId: this.orderId,
        lineId: this.lineId,
        productId: this.productId,
        productName: this.productName,
        imageUrl: this.imageUrl,
        unitPrice: this.unitPrice,
        quantity: this.quantity,
        lineTotal: this.lineTotal,
        createdAt: this.createdAt,
      }).filter(([, v]) => v !== undefined),
    )
  }

  static create(data: CreateOrderItemData): OrderItem {
    return new OrderItem(data)
  }

  applyPatch(patch: OrderItemPatch): OrderItem {
    const quantity = patch.quantity ?? this.quantity
    const unitPrice = patch.unitPrice ?? this.unitPrice
    return OrderItem.create({
      orderId: this.orderId,
      lineId: this.lineId,
      productId: this.productId,
      productName: patch.productName ?? this.productName,
      imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : this.imageUrl,
      unitPrice,
      quantity,
      lineTotal: quantity * unitPrice,
      createdAt: this.createdAt,
    })
  }

  static fromRecord(item: Record<string, unknown>): OrderItem {
    return new OrderItem(OrderItemPropsSchema.parse(item))
  }
}
