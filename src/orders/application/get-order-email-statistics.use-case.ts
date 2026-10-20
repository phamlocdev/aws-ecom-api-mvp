import { Inject, Injectable } from '@nestjs/common'
import { EmailDeliveryStatistics } from '../../mail/mail.types'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { ORDER_EMAIL_TYPES } from './order-email-types.const'

@Injectable()
export class GetOrderEmailStatisticsUseCase {
  constructor(
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  execute(): Promise<EmailDeliveryStatistics> {
    return this.emailTrackingService.getStatistics(ORDER_EMAIL_TYPES)
  }
}
