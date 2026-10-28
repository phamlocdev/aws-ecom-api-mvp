import { Inject, Injectable, Logger } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { InvalidInputError, NotFoundError } from '../../common/domain-error'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { OrderEventsPublisher } from '../infrastructure/order-events.publisher'

@Injectable()
export class UpdateOrderStatusUseCase {
  private readonly logger = new Logger(UpdateOrderStatusUseCase.name)

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(OrderEventsPublisher)
    private readonly orderEventsPublisher: OrderEventsPublisher,
  ) {}

  execute(user: AuthenticatedUser, orderId: string, status: OrderStatus): Promise<Order> {
    const actor = buildUserAuditMutationContext(user, 'Manual status update')
    if (status === OrderStatus.SHIPPED) {
      return this.ship(orderId, actor)
    }

    if (status === OrderStatus.CANCELLED) {
      return this.cancel(orderId, actor)
    }

    throw new InvalidInputError(
      `Only ${OrderStatus.SHIPPED} and ${OrderStatus.CANCELLED} status updates are supported.`,
    )
  }

  private async getOrderOrThrow(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findById(orderId)
    if (!order) throw new NotFoundError(`Order ${orderId} was not found.`)
    return order
  }

  private async ship(
    orderId: string,
    actor: ReturnType<typeof buildUserAuditMutationContext>,
  ): Promise<Order> {
    const order = await this.getOrderOrThrow(orderId)
    if (order.isShipped) {
      return order
    }

    if (!order.canBeShipped()) {
      throw new InvalidInputError('Only paid confirmed orders can be marked as shipped.')
    }

    const shippedAt = new Date().toISOString()
    order.ship(shippedAt)
    order.withAudit(actor)
    await this.orderRepository.save(order)

    const updatedOrder = await this.getOrderOrThrow(orderId)
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

  private async cancel(
    orderId: string,
    actor: ReturnType<typeof buildUserAuditMutationContext>,
  ): Promise<Order> {
    const order = await this.getOrderOrThrow(orderId)
    if (order.isCancelled) {
      return order
    }

    if (!order.canBeCancelled()) {
      throw new InvalidInputError('Only paid confirmed orders can be cancelled.')
    }

    const items = await this.orderRepository.findOrderItems(order.orderId)
    const inventoryItems = items.map((item) => ({ productId: item.productId, quantity: item.quantity }))

    const cancelledAt = new Date().toISOString()
    order.cancelWithRefund(cancelledAt)
    order.withAudit(actor)
    await this.orderRepository.cancelWithInventoryRelease(order, cancelledAt, inventoryItems, actor)

    const updatedOrder = await this.getOrderOrThrow(orderId)
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
