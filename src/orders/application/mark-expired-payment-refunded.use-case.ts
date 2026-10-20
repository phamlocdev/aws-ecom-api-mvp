import { Inject, Injectable } from '@nestjs/common'
import { AuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'

@Injectable()
export class MarkExpiredPaymentRefundedUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(
    orderId: string,
    transactionId: string,
    failureReason: string,
    actor: AuditMutationContext = systemAuditMutationContext('payment-ipn', failureReason),
  ): Promise<void> {
    return this.orderRepository.markExpiredPaymentRefunded(
      orderId,
      transactionId,
      failureReason,
      actor,
    )
  }
}
