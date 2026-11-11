import { Inject, Injectable } from '@nestjs/common'
import { ORDER_REPOSITORY, OrderPage, OrderRepositoryPort } from '../domain/order.repository.port'

@Injectable()
export class FindExpiredReservedOrdersUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  execute(
    nowEpochSeconds: number,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<OrderPage> {
    return this.orderRepository.findExpiredReserved(nowEpochSeconds, limit, exclusiveStartKey)
  }
}
