import { Inject, Injectable } from '@nestjs/common'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ConflictError } from '../../common/domain-error'
import { DynamoTablesService } from '../../config/dynamo-tables.service'
import { INVENTORY_REPOSITORY, InventoryRepositoryPort } from '../../inventory/domain/inventory.repository.port'
import { buildInventoryReleaseTransactItems } from '../../inventory/infrastructure/inventory-transact-items'
import { Order } from '../domain/order.entity'
import { ORDER_ITEM_REPOSITORY, OrderItemRepositoryPort } from '../domain/order-item.repository.port'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { aggregateReservedQuantities } from '../domain/order.rules'
import { buildOrderExpireTransactItem } from '../infrastructure/order-transact-items'

@Injectable()
export class ReleaseExpiredOrderReservationUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDER_ITEM_REPOSITORY)
    private readonly orderItemRepository: OrderItemRepositoryPort,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(DynamoTablesService)
    private readonly dynamoTables: DynamoTablesService,
  ) {}

  async execute(order: Order): Promise<boolean> {
    if (!order.canExpireReservation()) {
      return false
    }

    const items = await this.orderItemRepository.findByOrderId(order.orderId)
    if (items.length === 0) {
      return false
    }

    const timestamp = new Date().toISOString()
    const actor = systemAuditMutationContext('reservation-expiry-poller', 'Payment expired')
    const aggregatedItems = aggregateReservedQuantities(
      items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    )
    const inventoryTransactItems = buildInventoryReleaseTransactItems(
      this.dynamoTables.inventory,
      aggregatedItems,
      timestamp,
      actor,
    )

    const orderTransactItem = buildOrderExpireTransactItem(this.dynamoTables.orders, order, actor)
    if (!orderTransactItem) return false

    try {
      await this.orderRepository.executeTransaction([orderTransactItem, ...inventoryTransactItems])
      return true
    } catch (error) {
      if (error instanceof ConflictError) {
        return false
      }
      throw error
    }
  }
}
