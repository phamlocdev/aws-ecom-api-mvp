import { Inject, Injectable } from '@nestjs/common'
import { AuditMutationContext } from '../../audit/audit-actor'
import { NotFoundError } from '../../common/domain-error'
import { OrderItemPatch } from '../domain/order-item.entity'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'

export type UpdateOrderItemCommand = {
  orderId: string
  lineId: string
  patch: OrderItemPatch
  actor: AuditMutationContext
}

@Injectable()
export class UpdateOrderItemUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  async execute(command: UpdateOrderItemCommand): Promise<void> {
    const order = await this.orderRepository.findByIdWithItems(command.orderId)
    if (!order) {
      throw new NotFoundError(`Order ${command.orderId} not found`)
    }

    const updatedOrder = order.updateItem(command.lineId, command.patch).withAudit(command.actor)
    await this.orderRepository.saveWithItems(updatedOrder)
  }
}
