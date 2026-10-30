import { TransactItem } from '../../common/transact-item.type'
import { Order } from './order.entity'
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
   * Executes a multi-table DynamoDB transaction.
   * Throws ConflictError when any condition expression fails.
   */
  executeTransaction(items: TransactItem[]): Promise<void>
}
