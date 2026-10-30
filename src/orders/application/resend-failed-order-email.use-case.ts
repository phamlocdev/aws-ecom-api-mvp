import { Inject, Injectable } from '@nestjs/common'
import { InvalidInputError, NotFoundError } from '../../common/domain-error'
import { EmailTrackingService } from '../../mail/email-tracking.service'
import { EmailType } from '../../mail/mail.types'
import { SesMailService } from '../../mail/ses-mail.service'
import { Order, OrderItem, ResendOrderEmailResult } from '../domain/order.entity'
import { ORDER_ITEM_REPOSITORY, OrderItemRepositoryPort } from '../domain/order-item.repository.port'
import { ORDER_REPOSITORY, OrderRepositoryPort } from '../domain/order.repository.port'
import { normalizeEmail } from '../domain/order.rules'

@Injectable()
export class ResendFailedOrderEmailUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDER_ITEM_REPOSITORY)
    private readonly orderItemRepository: OrderItemRepositoryPort,
    @Inject(EmailTrackingService)
    private readonly emailTrackingService: EmailTrackingService,
    @Inject(SesMailService)
    private readonly sesMailService: SesMailService,
  ) {}

  async execute(
    orderId: string,
    emailType: EmailType,
    recipientEmail: string,
  ): Promise<ResendOrderEmailResult> {
    if (
      emailType !== 'ORDER_CONFIRMATION' &&
      emailType !== 'SHIPPED_ORDER_NOTIFICATION' &&
      emailType !== 'CANCELLED_ORDER_NOTIFICATION'
    ) {
      throw new InvalidInputError(`Email type ${emailType} is not supported for order resend.`)
    }

    const order = await this.orderRepository.findById(orderId)
    if (!order) throw new NotFoundError(`Order ${orderId} was not found.`)
    const normalizedRecipientEmail = normalizeEmail(recipientEmail)
    if (!normalizedRecipientEmail) {
      throw new InvalidInputError('recipientEmail is required.')
    }

    const retryableItem = await this.emailTrackingService.findLatestRetryableForRecipient({
      contextType: 'ORDER',
      contextId: orderId,
      emailType,
      recipientEmail: normalizedRecipientEmail,
    })

    if (!retryableItem) {
      return {
        orderId,
        emailType,
        recipientEmails: [],
        resentCount: 0,
        status: 'SKIPPED',
        reason: 'no-retryable-recipients',
      }
    }

    const items = await this.orderItemRepository.findByOrderId(orderId)
    const recipientEmails = [normalizedRecipientEmail]
    const result = await this.resendOrderEmailByType({
      order,
      items,
      emailType,
      recipientEmails,
      resendOfEmailId: retryableItem.emailId,
    })

    return {
      orderId,
      emailType,
      recipientEmails,
      resentCount: recipientEmails.length,
      status: result.status,
      reason: result.reason,
    }
  }

  private async resendOrderEmailByType(input: {
    order: Order
    items: OrderItem[]
    emailType: EmailType
    recipientEmails: string[]
    resendOfEmailId: string
  }) {
    if (input.emailType === 'ORDER_CONFIRMATION') {
      return this.sesMailService.sendOrderConfirmationEmail({
        order: input.order,
        items: input.items,
        recipientEmails: input.recipientEmails,
        resendOfEmailId: input.resendOfEmailId,
      })
    }

    if (input.emailType === 'SHIPPED_ORDER_NOTIFICATION') {
      return this.sesMailService.sendShippedOrderNotificationEmail({
        order: input.order,
        items: input.items,
        shippedAt: input.order.shippedAt ?? input.order.updatedAt,
        recipientEmails: input.recipientEmails,
        resendOfEmailId: input.resendOfEmailId,
      })
    }

    return this.sesMailService.sendCancelledOrderNotificationEmail({
      order: input.order,
      items: input.items,
      cancelledAt: input.order.cancelledAt ?? input.order.updatedAt,
      recipientEmails: input.recipientEmails,
      resendOfEmailId: input.resendOfEmailId,
    })
  }
}
