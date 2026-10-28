import { randomUUID } from 'crypto'
import { z } from 'zod'
import { OrderStatus } from './order-status.enum'
import { PaymentStatus } from './payment-status.enum'
import type { EmailType } from '../../mail/mail.types'
import { normalizeAdditionalReceivingEmails, toEpochSeconds } from './order.rules'
import { InvalidInputError } from '../../common/domain-error'
import type { AuditMutationContext } from '../../audit/audit-actor'

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

  private mutate(changes: Partial<OrderProps>): void {
    Object.assign(this as object, changes)
  }

  toRecord(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries({
        orderId: this.orderId,
        customerId: this.customerId,
        cartId: this.cartId,
        status: this.status,
        entityType: this.entityType,
        deduplicationKey: this.deduplicationKey,
        paymentStatus: this.paymentStatus,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        customerEmail: this.customerEmail,
        customerName: this.customerName,
        additionalReceivingEmails: this.additionalReceivingEmails,
        paymentAttemptId: this.paymentAttemptId,
        paymentRequestedAt: this.paymentRequestedAt,
        paidAt: this.paidAt,
        paymentTransactionId: this.paymentTransactionId,
        paymentFailureReason: this.paymentFailureReason,
        shippedAt: this.shippedAt,
        cancelledAt: this.cancelledAt,
        reservedAt: this.reservedAt,
        paymentExpiresAt: this.paymentExpiresAt,
        failureReason: this.failureReason,
        totalAmount: this.totalAmount,
        lastModifiedByType: this.lastModifiedByType,
        lastModifiedById: this.lastModifiedById,
        lastModifiedByEmail: this.lastModifiedByEmail,
        lastModifiedReason: this.lastModifiedReason,
      }).filter(([, v]) => v !== undefined),
    )
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

  // --- Guard methods ---

  canBeShipped(): boolean {
    return this.status === OrderStatus.CONFIRMED && this.paymentStatus === PaymentStatus.PAID
  }

  canBeCancelled(): boolean {
    return this.status === OrderStatus.CONFIRMED && this.paymentStatus === PaymentStatus.PAID
  }

  canTriggerPayment(): boolean {
    return (
      this.status === OrderStatus.RESERVED &&
      this.paymentStatus !== PaymentStatus.PAID &&
      this.totalAmount !== undefined &&
      this.paymentExpiresAt !== undefined &&
      !this.isPaymentExpired()
    )
  }

  canExpireReservation(): boolean {
    return this.status === OrderStatus.RESERVED && this.isPaymentExpired()
  }

  isReadyToProcessPayment(): boolean {
    return this.status === OrderStatus.RESERVED && this.paymentStatus === PaymentStatus.PROCESSING
  }

  // --- State transition methods (validate → mutate this → return this for chaining) ---

  reserve(totalAmount: number, paymentExpiresAt: number, reservedAt: string): void {
    if (this.status !== OrderStatus.PENDING) {
      throw new InvalidInputError(`Order cannot be reserved from status ${this.status}`)
    }
    this.mutate({ status: OrderStatus.RESERVED, totalAmount, paymentExpiresAt, reservedAt, updatedAt: reservedAt })
  }

  fail(reason: string, updatedAt: string): void {
    if (this.isInTerminalState) {
      throw new InvalidInputError(`Order is already in terminal state ${this.status}`)
    }
    this.mutate({ status: OrderStatus.FAILED, failureReason: reason, updatedAt })
  }

  ship(shippedAt: string): void {
    if (!this.canBeShipped()) {
      throw new InvalidInputError(`Order cannot be shipped from status ${this.status}`)
    }
    this.mutate({ status: OrderStatus.SHIPPED, shippedAt, updatedAt: shippedAt })
  }

  cancelWithRefund(cancelledAt: string): void {
    if (!this.canBeCancelled()) {
      throw new InvalidInputError(`Order cannot be cancelled from status ${this.status}`)
    }
    this.mutate({ status: OrderStatus.CANCELLED, cancelledAt, updatedAt: cancelledAt })
  }

  failAsExpired(reason: string, updatedAt: string): void {
    if (this.isInTerminalState) {
      throw new InvalidInputError(`Order is already in terminal state ${this.status}`)
    }
    this.mutate({ status: OrderStatus.EXPIRED, failureReason: reason, updatedAt })
  }

  startPayment(paymentAttemptId: string, requestedAt: string): void {
    if (this.status !== OrderStatus.RESERVED) {
      throw new InvalidInputError(`Order cannot start payment in status ${this.status}`)
    }
    if (this.paymentStatus === PaymentStatus.PAID) {
      throw new InvalidInputError('Order payment is already paid.')
    }
    if (this.isPaymentExpired()) {
      throw new InvalidInputError('Order payment window has expired.')
    }
    this.mutate({
      paymentStatus: PaymentStatus.PROCESSING,
      paymentRequestedAt: requestedAt,
      paymentAttemptId,
      paymentFailureReason: undefined,
      paymentTransactionId: undefined,
      paidAt: undefined,
      updatedAt: requestedAt,
    })
  }

  confirmPayment(paymentAttemptId: string, transactionId: string, paidAt: string): void {
    if (this.status !== OrderStatus.RESERVED) {
      throw new InvalidInputError(`Order cannot confirm payment in status ${this.status}`)
    }
    if (this.paymentStatus !== PaymentStatus.PROCESSING) {
      throw new InvalidInputError('Order payment is not in PROCESSING state.')
    }
    if (this.paymentAttemptId !== paymentAttemptId) {
      throw new InvalidInputError('Payment attempt ID mismatch.')
    }
    this.mutate({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID, paymentTransactionId: transactionId, paidAt, updatedAt: paidAt })
  }

  failPayment(paymentAttemptId: string, failureReason: string): void {
    if (this.paymentStatus !== PaymentStatus.PROCESSING) {
      throw new InvalidInputError('Order payment is not in PROCESSING state.')
    }
    if (this.paymentAttemptId !== paymentAttemptId) {
      throw new InvalidInputError('Payment attempt ID mismatch.')
    }
    this.mutate({ paymentStatus: PaymentStatus.FAILED, paymentFailureReason: failureReason, updatedAt: new Date().toISOString() })
  }

  refundExpiredPayment(transactionId: string, failureReason: string): void {
    this.mutate({
      status: OrderStatus.EXPIRED,
      paymentStatus: PaymentStatus.FAILED,
      paymentTransactionId: transactionId,
      paymentFailureReason: failureReason,
      failureReason,
      updatedAt: new Date().toISOString(),
    })
  }

  withAudit(actor: AuditMutationContext): void {
    this.mutate({
      lastModifiedByType: actor.actorType,
      lastModifiedById: actor.actorId ?? 'unknown',
      lastModifiedByEmail: actor.actorEmail ?? 'unknown',
      lastModifiedReason: actor.reason,
    })
  }

  static computeTotal(items: Pick<OrderItem, 'lineTotal'>[]): number {
    return items.reduce((total, item) => total + item.lineTotal, 0)
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
