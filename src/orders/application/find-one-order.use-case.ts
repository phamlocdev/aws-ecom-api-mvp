import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Role } from '../../auth/roles.enum'
import { ForbiddenDomainError, NotFoundError } from '../../common/domain-error'
import { OrderDetails } from '../domain/order.entity'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'

@Injectable()
export class FindOneOrderUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  async execute(user: AuthenticatedUser, orderId: string): Promise<OrderDetails> {
    const order = await this.orderRepository.findById(orderId)
    if (!order) {
      throw new NotFoundError(`Order ${orderId} was not found.`)
    }

    const isAdminOrManager = user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER)
    if (!isAdminOrManager && order.customerId !== user.sub) {
      throw new ForbiddenDomainError('You do not have access to this order.')
    }

    const items = await this.orderRepository.findOrderItems(order.orderId)
    return {
      ...order,
      items,
    }
  }
}
