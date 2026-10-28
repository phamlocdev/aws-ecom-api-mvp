import { AuditMutationContext } from '../../audit/audit-actor'
import { ReservedInventoryItem } from '../../inventory/domain/inventory.entity'
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

  /** Full overwrite — persists all fields from order.toRecord(). */
  save(order: Order): Promise<void>

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

  /**
   * Atomically cancels the order and releases inventory items.
   * Throws ConflictError if inventory release conditions fail.
   */
  cancelWithInventoryRelease(
    order: Order,
    cancelledAt: string,
    inventoryItems: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<void>

  /**
   * Atomically marks the order FAILED and releases inventory items in a
   * single DynamoDB transaction.
   */
  failWithInventoryRelease(
    orderId: string,
    failureReason: string,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<void>

  /**
   * Returns false (instead of throwing) when the inventory conditions
   * no longer match, since this is a best-effort sweep operation.
   */
  expireWithInventoryRelease(
    order: Order,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext,
  ): Promise<boolean>
}
