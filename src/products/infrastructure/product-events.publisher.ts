import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const PRODUCT_EVENT_SOURCE = 'ecommerce.products'
const PRODUCT_CREATED_DETAIL_TYPE = 'ProductCreated'
const PRODUCT_UPDATED_DETAIL_TYPE = 'ProductUpdated'
const PRODUCT_DELETED_DETAIL_TYPE = 'ProductDeleted'

type ProductEventDetailType =
  | typeof PRODUCT_CREATED_DETAIL_TYPE
  | typeof PRODUCT_UPDATED_DETAIL_TYPE
  | typeof PRODUCT_DELETED_DETAIL_TYPE

export interface ProductMutationEventDetail {
  productId: string
}

@Injectable()
export class ProductEventsPublisher {
  private readonly logger = new Logger(ProductEventsPublisher.name)
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

  async publishProductCreated(detail: ProductMutationEventDetail): Promise<void> {
    await this.publishProductEvent(PRODUCT_CREATED_DETAIL_TYPE, detail)
  }

  async publishProductUpdated(detail: ProductMutationEventDetail): Promise<void> {
    await this.publishProductEvent(PRODUCT_UPDATED_DETAIL_TYPE, detail)
  }

  async publishProductDeleted(detail: ProductMutationEventDetail): Promise<void> {
    await this.publishProductEvent(PRODUCT_DELETED_DETAIL_TYPE, detail)
  }

  private async publishProductEvent(
    detailType: ProductEventDetailType,
    detail: ProductMutationEventDetail,
  ): Promise<void> {
    const response = await this.eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: PRODUCT_EVENT_SOURCE,
            DetailType: detailType,
            Detail: JSON.stringify(detail),
          },
        ],
      }),
    )

    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      const failedEntry = response.Entries?.find((entry) => entry.ErrorCode || entry.ErrorMessage)
      this.logger.error(
        `Failed to publish ${detailType} for product ${detail.productId}: ${failedEntry?.ErrorCode ?? 'unknown-error'} ${failedEntry?.ErrorMessage ?? ''}`.trim(),
      )
      throw new Error(`Failed to publish ${detailType} event.`)
    }
  }
}
