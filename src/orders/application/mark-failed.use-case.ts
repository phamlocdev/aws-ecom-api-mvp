import { Inject, Injectable } from '@nestjs/common'
import { AuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { OrderStatus } from '../domain/order-status.enum'

@Injectable()
export class MarkFailedUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(
    orderId: string,
    status: OrderStatus,
    failureReason: string,
    actor: AuditMutationContext = systemAuditMutationContext('orders-service', failureReason),
  ): Promise<void> {
    return this.orderRepository.markFailed(orderId, status, failureReason, actor)
  }
}
