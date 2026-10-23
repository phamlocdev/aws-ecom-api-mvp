import { Inject, Injectable } from '@nestjs/common'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { EmailTrackingView } from '../../mail/domain/email-tracking.entity'
import { GetOrderByIdUseCase } from './get-order-by-id.use-case'
import { ORDER_EMAIL_TYPES } from './order-email-types.const'

@Injectable()
export class GetOrderEmailTrackingUseCase {
  constructor(
    @Inject(GetOrderByIdUseCase)
    private readonly getOrderByIdUseCase: GetOrderByIdUseCase,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(orderId: string): Promise<EmailTrackingView[]> {
    await this.getOrderByIdUseCase.execute(orderId)
    return this.emailTrackingService.findByContext('ORDER', orderId, ORDER_EMAIL_TYPES)
  }
}
