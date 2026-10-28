import { Inject, Injectable } from '@nestjs/common'
import { systemAuditMutationContext } from '../../audit/audit-actor'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { Order } from '../domain/order.entity'

@Injectable()
export class ReleaseExpiredOrderReservationUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  async execute(order: Order): Promise<boolean> {
    if (!order.canExpireReservation()) {
      return false
    }

    const items = await this.orderRepository.findOrderItems(order.orderId)
    if (items.length === 0) {
      return false
    }

    const actor = systemAuditMutationContext('reservation-expiry-poller', 'Payment expired')
    return this.orderRepository.expireWithInventoryRelease(
      order,
      items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      actor,
    )
  }
}
