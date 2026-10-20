import { Inject, Injectable } from '@nestjs/common'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { OrderItem } from '../domain/order.entity'

@Injectable()
export class FindOrderItemsUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(orderId: string): Promise<OrderItem[]> {
    return this.orderRepository.findOrderItems(orderId)
  }
}
