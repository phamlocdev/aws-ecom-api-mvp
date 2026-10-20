import { Inject, Injectable, Logger } from '@nestjs/common'
import { AuditMutationContext } from '../../audit/audit-actor'
import { InvalidInputError } from '../../common/domain-error'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { PaymentStatus } from '../domain/payment-status.enum'
import { OrderEventsPublisher } from '../infrastructure/order-events.publisher'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'

@Injectable()
export class MarkOrderShippedUseCase {
  private readonly logger = new Logger(MarkOrderShippedUseCase.name)

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
    @Inject(OrderEventsPublisher)
    private readonly orderEventsPublisher: OrderEventsPublisher,
  ) {}

  async execute(orderId: string, actor: AuditMutationContext): Promise<Order> {
    const order = await this.getOrderByIdUseCase.execute(orderId)
    if (order.status === OrderStatus.SHIPPED) {
      return order
    }

    if (order.status !== OrderStatus.CONFIRMED || order.paymentStatus !== PaymentStatus.PAID) {
      throw new InvalidInputError('Only paid confirmed orders can be marked as shipped.')
    }

    const shippedAt = new Date().toISOString()
    await this.orderRepository.markShipped(orderId, shippedAt, actor)

    const updatedOrder = await this.getOrderByIdUseCase.execute(orderId)
    try {
      await this.orderEventsPublisher.publishOrderShipped({
        orderId: updatedOrder.orderId,
        shippedAt,
      })
    } catch (error) {
      this.logger.error(
        `Failed to publish shipped event for order ${updatedOrder.orderId} shippedAt=${shippedAt}.`,
        error,
      )
      throw error
    }

    return updatedOrder
  }
}
