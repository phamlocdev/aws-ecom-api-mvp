import { OrderStatus } from './order-status.enum'
import { PaymentStatus } from './payment-status.enum'
import type { EmailType } from '../mail/mail.types'

export interface Order {
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
  lastModifiedByType?: OrderMutationActorType
  lastModifiedById?: string
  lastModifiedByEmail?: string
  lastModifiedReason?: string
}

export type OrderMutationActorType = 'customer' | 'admin' | 'system' | 'unknown'

export interface OrderMutationContext {
  actorType: OrderMutationActorType
  actorId?: string
  actorEmail?: string
  reason: string
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

export interface OrderItem {
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

export interface OrderDetails extends Order {
  items: OrderItem[]
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
