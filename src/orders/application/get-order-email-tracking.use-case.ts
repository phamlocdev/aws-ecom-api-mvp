import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '../../common/domain-error'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { EmailTrackingView } from '../../mail/domain/email-tracking.entity'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { ORDER_EMAIL_TYPES } from './order-email-types.const'

@Injectable()
export class GetOrderEmailTrackingUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(orderId: string): Promise<EmailTrackingView[]> {
    const order = await this.orderRepository.findById(orderId)
    if (!order) throw new NotFoundError(`Order ${orderId} was not found.`)
    return this.emailTrackingService.findByContext('ORDER', orderId, ORDER_EMAIL_TYPES)
  }
}
