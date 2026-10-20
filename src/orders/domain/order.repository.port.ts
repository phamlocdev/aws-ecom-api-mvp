import { AuditMutationContext } from '../../audit/audit-actor'
import { ReservedInventoryItem } from '../../inventory/inventory.types'
import { Order, OrderItem } from './order.entity'
import { OrderStatus } from './order-status.enum'

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY')

export interface OrderPage {
  items: Order[]
  lastEvaluatedKey?: Record<string, unknown>
}

export interface OrderListFilter {
  isAdminOrManager: boolean
  requestingCustomerId: string
  status?: OrderStatus
  customerId?: string
  customerEmail?: string
}

/**
 * Port implemented by the infrastructure layer. Kept free of any
 * NestJS/AWS SDK type so the application layer can depend on it directly.
 */
export interface OrderRepositoryPort {
  /** Throws ConflictError if order.orderId already exists. */
  create(order: Order): Promise<void>

  createOrderItems(items: OrderItem[]): Promise<void>

  findOrderItems(orderId: string): Promise<OrderItem[]>

  /** Returns null if the order does not exist. */
  findById(orderId: string): Promise<Order | null>

  findMany(
    filter: OrderListFilter,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<OrderPage>

  findExpiredReserved(
    nowEpochSeconds: number,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<OrderPage>

  markReserved(
    orderId: string,
    totalAmount: number,
    paymentExpiresAt: number,
    actor: AuditMutationContext,
  ): Promise<void>

  markFailed(
    orderId: string,
    status: OrderStatus,
    failureReason: string,
    actor: AuditMutationContext,
  ): Promise<void>

  /** Throws ConflictError if the order is not CONFIRMED/PAID. */
  markShipped(orderId: string, shippedAt: string, actor: AuditMutationContext): Promise<void>

  /**
   * Updates the order to CANCELLED and releases the given inventory items in a
   * single DynamoDB transaction. Throws ConflictError if the order is not
   * CONFIRMED/PAID or the inventory release conditions fail.
   */
  cancelConfirmedPaidOrder(
    orderId: string,
    cancelledAt: string,
    inventoryItems: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<void>

  /** Throws ConflictError if the order cannot start a new payment attempt. */
  startPayment(
    orderId: string,
    paymentAttemptId: string,
    requestedAt: string,
    nowEpochSeconds: number,
    actor: AuditMutationContext,
  ): Promise<void>

  /** Throws ConflictError if the payment attempt no longer matches. */
  markPaymentSucceeded(
    orderId: string,
    paymentAttemptId: string,
    transactionId: string,
    actor: AuditMutationContext,
  ): Promise<void>

  /** Throws ConflictError if the payment attempt no longer matches. */
  markPaymentFailed(
    orderId: string,
    paymentAttemptId: string,
    failureReason: string,
    actor: AuditMutationContext,
  ): Promise<void>

  /** Throws ConflictError if the order is already confirmed/paid. */
  markExpiredPaymentRefunded(
    orderId: string,
    transactionId: string,
    failureReason: string,
    actor: AuditMutationContext,
  ): Promise<void>

  failPendingOrderAndReleaseReservation(
    orderId: string,
    failureReason: string,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<void>

  /**
   * Returns false (instead of throwing) when the order/inventory conditions
   * no longer match, since this is a best-effort sweep operation.
   */
  expireReservationAndReleaseInventoryIfUnpaid(
    order: Order,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<boolean>
}
