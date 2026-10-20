import { Inject, Injectable, Logger } from '@nestjs/common'
import { AuditMutationContext } from '../../audit/audit-actor'
import { InvalidInputError } from '../../common/domain-error'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { PaymentStatus } from '../domain/payment-status.enum'
import { OrderEventsPublisher } from '../infrastructure/order-events.publisher'
import { FindOrderItemsUseCase } from './find-order-items.use-case'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'

@Injectable()
export class CancelConfirmedPaidOrderUseCase {
  private readonly logger = new Logger(CancelConfirmedPaidOrderUseCase.name)

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
    @Inject(FindOrderItemsUseCase)
    private readonly findOrderItemsUseCase: FindOrderItemsUseCase,
    @Inject(OrderEventsPublisher)
    private readonly orderEventsPublisher: OrderEventsPublisher,
  ) {}

  async execute(orderId: string, actor: AuditMutationContext): Promise<Order> {
    const order = await this.getOrderByIdUseCase.execute(orderId)
    if (order.status === OrderStatus.CANCELLED) {
      return order
    }

    if (order.status !== OrderStatus.CONFIRMED || order.paymentStatus !== PaymentStatus.PAID) {
      throw new InvalidInputError('Only paid confirmed orders can be cancelled.')
    }

    const items = await this.findOrderItemsUseCase.execute(order.orderId)
    const inventoryItems = items.map((item) => ({ productId: item.productId, quantity: item.quantity }))

    const cancelledAt = new Date().toISOString()
    await this.orderRepository.cancelConfirmedPaidOrder(orderId, cancelledAt, inventoryItems, actor)

    const updatedOrder = await this.getOrderByIdUseCase.execute(orderId)
    try {
      await this.orderEventsPublisher.publishOrderCancelled({
        orderId: updatedOrder.orderId,
        cancelledAt,
        totalAmount: updatedOrder.totalAmount ?? 0,
      })
    } catch (error) {
      this.logger.error(
        `Failed to publish cancelled event for order ${updatedOrder.orderId} cancelledAt=${cancelledAt}.`,
        error,
      )
      throw error
    }

    return updatedOrder
  }
}
