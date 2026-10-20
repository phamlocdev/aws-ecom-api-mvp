import { Inject, Injectable } from '@nestjs/common'
import { AuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'

@Injectable()
export class MarkPaymentFailedUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(
    orderId: string,
    paymentAttemptId: string,
    failureReason: string,
    actor: AuditMutationContext = systemAuditMutationContext('payment-ipn', failureReason),
  ): Promise<void> {
    return this.orderRepository.markPaymentFailed(orderId, paymentAttemptId, failureReason, actor)
  }
}
