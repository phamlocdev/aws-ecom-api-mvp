import { OrderItem } from './order-item.entity'

export const ORDER_ITEM_REPOSITORY = Symbol('ORDER_ITEM_REPOSITORY')

export interface OrderItemRepositoryPort {
  createMany(items: OrderItem[]): Promise<void>
  findByOrderId(orderId: string): Promise<OrderItem[]>
}
