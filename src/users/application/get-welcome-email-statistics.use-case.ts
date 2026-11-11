import { Inject, Injectable } from '@nestjs/common'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { EmailDeliveryStatistics } from '../../mail/mail.types'

@Injectable()
export class GetWelcomeEmailStatisticsUseCase {
  constructor(
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
  ) {}

  async execute(): Promise<EmailDeliveryStatistics> {
    return this.emailTrackingService.getStatistics(['WELCOME_NEW_CUSTOMER'])
  }
}
