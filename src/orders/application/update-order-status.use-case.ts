import { Inject, Injectable } from '@nestjs/common'
import { buildUserAuditMutationContext } from '../../audit/audit-actor'
import { AuthenticatedUser } from '../../auth/auth.types'
import { InvalidInputError } from '../../common/domain-error'
import { Order } from '../domain/order.entity'
import { OrderStatus } from '../domain/order-status.enum'
import { CancelConfirmedPaidOrderUseCase } from './cancel-confirmed-paid-order.use-case'
import { MarkOrderShippedUseCase } from './mark-order-shipped.use-case'

@Injectable()
export class UpdateOrderStatusUseCase {
  constructor(
    @Inject(MarkOrderShippedUseCase)
    private readonly markOrderShippedUseCase: MarkOrderShippedUseCase,
    @Inject(CancelConfirmedPaidOrderUseCase)
    private readonly cancelConfirmedPaidOrderUseCase: CancelConfirmedPaidOrderUseCase,
  ) {}

  execute(user: AuthenticatedUser, orderId: string, status: OrderStatus): Promise<Order> {
    const actor = buildUserAuditMutationContext(user, 'Manual status update')
    if (status === OrderStatus.SHIPPED) {
      return this.markOrderShippedUseCase.execute(orderId, actor)
    }

    if (status === OrderStatus.CANCELLED) {
      return this.cancelConfirmedPaidOrderUseCase.execute(orderId, actor)
    }

    throw new InvalidInputError(
      `Only ${OrderStatus.SHIPPED} and ${OrderStatus.CANCELLED} status updates are supported.`,
    )
  }
}
