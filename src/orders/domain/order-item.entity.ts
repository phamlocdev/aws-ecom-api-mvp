import { z } from 'zod'

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

  static fromRecord(item: Record<string, unknown>): OrderItem {
    return new OrderItem(OrderItemPropsSchema.parse(item))
  }
}
