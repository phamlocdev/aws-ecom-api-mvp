import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '../../common/domain-error'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { Order } from '../domain/order.entity'

@Injectable()
export class GetOrderByIdUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  async execute(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findById(orderId)
    if (!order) {
      throw new NotFoundError(`Order ${orderId} was not found.`)
    }

    return order
  }
}
