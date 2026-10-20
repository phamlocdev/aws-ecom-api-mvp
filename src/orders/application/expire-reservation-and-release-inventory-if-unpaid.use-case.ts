import { Inject, Injectable } from '@nestjs/common'
import { AuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { ReservedInventoryItem } from '../../inventory/inventory.types'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { Order } from '../domain/order.entity'

@Injectable()
export class ExpireReservationAndReleaseInventoryIfUnpaidUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(
    order: Order,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext = systemAuditMutationContext(
      'reservation-expiry-poller',
      'Payment expired',
    ),
  ): Promise<boolean> {
    return this.orderRepository.expireReservationAndReleaseInventoryIfUnpaid(order, items, actor)
  }
}
