import { Inject, Injectable } from '@nestjs/common'
import { AuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { ReservedInventoryItem } from '../../inventory/domain/inventory.entity'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'

@Injectable()
export class FailPendingOrderAndReleaseReservationUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(
    orderId: string,
    failureReason: string,
    items: ReservedInventoryItem[],
    actor: AuditMutationContext = systemAuditMutationContext('orders-service', failureReason),
  ): Promise<void> {
    return this.orderRepository.failPendingOrderAndReleaseReservation(
      orderId,
      failureReason,
      items,
      actor,
    )
  }
}
