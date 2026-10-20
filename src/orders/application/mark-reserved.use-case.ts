import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AuditMutationContext, systemAuditMutationContext } from '../../audit/audit-actor'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { toEpochSeconds } from '../domain/order.rules'

@Injectable()
export class MarkReservedUseCase {
  private readonly paymentConfirmationTimeoutSeconds: number

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(ConfigService)
    configService: ConfigService,
  ) {
    this.paymentConfirmationTimeoutSeconds = Number(
      configService.getOrThrow<number>('PAYMENT_CONFIRMATION_SECONDS_TIMEOUT'),
    )
  }

  execute(
    orderId: string,
    totalAmount: number,
    actor: AuditMutationContext = systemAuditMutationContext('orders-service', 'Order reserved'),
  ): Promise<void> {
    const paymentExpiresAt = toEpochSeconds(Date.now()) + this.paymentConfirmationTimeoutSeconds
    return this.orderRepository.markReserved(orderId, totalAmount, paymentExpiresAt, actor)
  }
}
