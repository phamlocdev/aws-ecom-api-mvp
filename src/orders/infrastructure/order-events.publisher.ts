import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const ORDER_EVENT_SOURCE = 'ecommerce.orders'
const ORDER_SHIPPED_DETAIL_TYPE = 'OrderShipped'
const ORDER_CANCELLED_DETAIL_TYPE = 'OrderCancelled'

export interface OrderShippedEventDetail {
  orderId: string
  shippedAt: string
}

export interface OrderCancelledEventDetail {
  orderId: string
  cancelledAt: string
  totalAmount: number
}

@Injectable()
export class OrderEventsPublisher {
  private readonly logger = new Logger(OrderEventsPublisher.name)
  private readonly eventBridgeClient: EventBridgeClient
  private readonly busName: string

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const region =
      configService.get<string>('AWS_REGION') ??
      configService.get<string>('AWS_DEFAULT_REGION') ??
      'ap-southeast-1'

    this.eventBridgeClient = new EventBridgeClient({ region })
    this.busName = configService.get<string>('ORDER_EVENTS_BUS_NAME') ?? 'ecommerce-domain-events'
  }

  async publishOrderShipped(detail: OrderShippedEventDetail): Promise<void> {
    await this.publishOrderEvent(ORDER_SHIPPED_DETAIL_TYPE, detail)
  }

  async publishOrderCancelled(detail: OrderCancelledEventDetail): Promise<void> {
    await this.publishOrderEvent(ORDER_CANCELLED_DETAIL_TYPE, detail)
  }

  private async publishOrderEvent(
    detailType: typeof ORDER_SHIPPED_DETAIL_TYPE | typeof ORDER_CANCELLED_DETAIL_TYPE,
    detail: OrderShippedEventDetail | OrderCancelledEventDetail,
  ): Promise<void> {
    const response = await this.eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: ORDER_EVENT_SOURCE,
            DetailType: detailType,
            Detail: JSON.stringify(detail),
          },
        ],
      }),
    )

    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      const failedEntry = response.Entries?.find((entry) => entry.ErrorCode || entry.ErrorMessage)
      this.logger.error(
        `Failed to publish ${detailType} for order ${detail.orderId}: ${failedEntry?.ErrorCode ?? 'unknown-error'} ${failedEntry?.ErrorMessage ?? ''}`.trim(),
      )
      throw new Error(`Failed to publish ${detailType} event.`)
    }
  }
}
