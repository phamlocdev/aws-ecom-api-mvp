import { randomUUID } from 'crypto'
import { z } from 'zod'
import { OrderStatus } from './order-status.enum'
import { PaymentStatus } from './payment-status.enum'
import type { EmailType } from '../../mail/mail.types'
import { normalizeAdditionalReceivingEmails, toEpochSeconds } from './order.rules'

export const ORDERS_ENTITY_TYPE = 'ORDER'

const OrderPropsSchema = z.object({
  orderId: z.string(),
  customerId: z.string(),
  customerEmail: z.string().optional(),
  customerName: z.string().optional(),
  additionalReceivingEmails: z.array(z.string()).optional(),
  cartId: z.string(),
  status: z.enum(['PENDING', 'RESERVED', 'CONFIRMED', 'SHIPPED', 'CANCELLED', 'FAILED', 'EXPIRED']),
  entityType: z.string(),
  deduplicationKey: z.string(),
  paymentStatus: z.enum(['NOT_STARTED', 'PROCESSING', 'PAID', 'FAILED']),
  paymentAttemptId: z.string().optional(),
  paymentRequestedAt: z.string().optional(),
  paidAt: z.string().optional(),
  paymentTransactionId: z.string().optional(),
  paymentFailureReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  shippedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  reservedAt: z.string().optional(),
  paymentExpiresAt: z.number().optional(),
  failureReason: z.string().optional(),
  totalAmount: z.number().optional(),
  lastModifiedByType: z.string().optional(),
  lastModifiedById: z.string().optional(),
  lastModifiedByEmail: z.string().optional(),
  lastModifiedReason: z.string().optional(),
})

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

type OrderProps = {
  orderId: string
  customerId: string
  customerEmail?: string
  customerName?: string
  additionalReceivingEmails?: string[]
  cartId: string
  status: OrderStatus
  entityType: string
  deduplicationKey: string
  paymentStatus: PaymentStatus
  paymentAttemptId?: string
  paymentRequestedAt?: string
  paidAt?: string
  paymentTransactionId?: string
  paymentFailureReason?: string
  createdAt: string
  updatedAt: string
  shippedAt?: string
  cancelledAt?: string
  reservedAt?: string
  paymentExpiresAt?: number
  failureReason?: string
  totalAmount?: number
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
}

export type CreateOrderData = {
  customerId: string
  customerEmail?: string
  customerName?: string
  additionalReceivingEmails?: string[]
  cartId: string
  lastModifiedByType?: string
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
}

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

export class Order {
  readonly orderId!: string
  readonly customerId!: string
  readonly customerEmail?: string
  readonly customerName?: string
  readonly additionalReceivingEmails?: string[]
  readonly cartId!: string
  readonly status!: OrderStatus
  readonly entityType!: string
  readonly deduplicationKey!: string
  readonly paymentStatus!: PaymentStatus
  readonly paymentAttemptId?: string
  readonly paymentRequestedAt?: string
  readonly paidAt?: string
  readonly paymentTransactionId?: string
  readonly paymentFailureReason?: string
  readonly createdAt!: string
  readonly updatedAt!: string
  readonly shippedAt?: string
  readonly cancelledAt?: string
  readonly reservedAt?: string
  readonly paymentExpiresAt?: number
  readonly failureReason?: string
  readonly totalAmount?: number
  readonly lastModifiedByType?: string
  readonly lastModifiedById?: string
  readonly lastModifiedByEmail?: string
  readonly lastModifiedReason?: string

  private constructor(props: OrderProps) {
    Object.assign(this, props)
  }

  static create(data: CreateOrderData): Order {
    const timestamp = new Date().toISOString()
    return new Order({
      orderId: randomUUID(),
      customerId: data.customerId,
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      additionalReceivingEmails: normalizeAdditionalReceivingEmails(data.additionalReceivingEmails),
      cartId: data.cartId,
      status: OrderStatus.PENDING,
      entityType: ORDERS_ENTITY_TYPE,
      deduplicationKey: randomUUID(),
      paymentStatus: PaymentStatus.NOT_STARTED,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastModifiedByType: data.lastModifiedByType,
      lastModifiedById: data.lastModifiedById,
      lastModifiedByEmail: data.lastModifiedByEmail,
      lastModifiedReason: data.lastModifiedReason,
    })
  }

  static fromRecord(item: Record<string, unknown>): Order {
    const parsed = OrderPropsSchema.parse(item)
    return new Order({
      ...parsed,
      status: parsed.status as OrderStatus,
      paymentStatus: parsed.paymentStatus as PaymentStatus,
    })
  }

  isPaymentExpired(): boolean {
    return Boolean(this.paymentExpiresAt && this.paymentExpiresAt <= toEpochSeconds(Date.now()))
  }

  get isPaid(): boolean {
    return this.paymentStatus === PaymentStatus.PAID
  }

  get isCancelled(): boolean {
    return this.status === OrderStatus.CANCELLED
  }

  get isShipped(): boolean {
    return this.status === OrderStatus.SHIPPED
  }

  get isInTerminalState(): boolean {
    return [OrderStatus.CANCELLED, OrderStatus.FAILED, OrderStatus.EXPIRED].includes(this.status)
  }
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

  static create(data: CreateOrderItemData): OrderItem {
    return new OrderItem(data)
  }

  static fromRecord(item: Record<string, unknown>): OrderItem {
    return new OrderItem(OrderItemPropsSchema.parse(item))
  }
}

export interface OrderDetails extends Order {
  items: OrderItem[]
}

export interface TriggerPaymentResult {
  orderId: string
  paymentStatus: PaymentStatus
  paymentUrl: string
  paymentExpiresAt?: number
}

export interface VnpayReturnResult {
  redirectUrl: string
}

export interface PlaceOrderMessage {
  orderId: string
  customerId: string
  cartId: string
  deduplicationKey: string
  requestedAt: string
}

export interface ResendOrderEmailResult {
  orderId: string
  emailType: EmailType
  recipientEmails: string[]
  resentCount: number
  status: string
  reason?: string
}
