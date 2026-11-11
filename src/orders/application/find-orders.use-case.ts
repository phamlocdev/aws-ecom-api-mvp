import { Inject, Injectable } from '@nestjs/common'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Role } from '../../auth/roles.enum'
import { PaginatedResponse } from '../../pagination/pagination.types'
import { resolvePaginationState, toPaginatedResponse } from '../../pagination/pagination.util'
import { Order } from '../domain/order.entity'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { ListOrdersQuery } from './list-orders-query.type'

@Injectable()
export class FindOrdersUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  async execute(
    user: AuthenticatedUser,
    query: ListOrdersQuery,
  ): Promise<PaginatedResponse<Order>> {
    const isAdminOrManager = user.groups.includes(Role.ADMIN) || user.groups.includes(Role.MANAGER)

    const scope = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.customerEmail ? { customerEmail: query.customerEmail } : {}),
      ...(isAdminOrManager ? { role: 'staff' } : { role: 'customer' }),
    }
    const pagination = resolvePaginationState('orders', query, scope)

    const page = await this.orderRepository.findMany(
      {
        isAdminOrManager,
        requestingCustomerId: user.sub,
        status: query.status,
        customerId: query.customerId,
        customerEmail: query.customerEmail,
      },
      pagination.limit,
      pagination.startKey ?? undefined,
    )

    return toPaginatedResponse('orders', pagination, page.items, page.lastEvaluatedKey)
  }
}
