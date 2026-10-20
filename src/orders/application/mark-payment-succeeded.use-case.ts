import { Inject, Injectable } from '@nestjs/common'
import { AuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'

@Injectable()
export class MarkPaymentSucceededUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(
    orderId: string,
    paymentAttemptId: string,
    transactionId: string,
    actor: AuditMutationContext = systemAuditMutationContext('payment-ipn', 'Payment confirmed'),
  ): Promise<void> {
    return this.orderRepository.markPaymentSucceeded(orderId, paymentAttemptId, transactionId, actor)
  }
}
