import { Logger } from '@nestjs/common'
import { ProductEventsPublisher } from '../infrastructure/product-events.publisher'

export type ProductMutation = 'created' | 'updated' | 'deleted'

export async function publishProductMutationBestEffort(
  publisher: ProductEventsPublisher,
  logger: Logger,
  mutation: ProductMutation,
  productId: string,
): Promise<void> {
  try {
    if (mutation === 'created') {
      await publisher.publishProductCreated({ productId })
      return
    }

    if (mutation === 'updated') {
      await publisher.publishProductUpdated({ productId })
      return
    }

    await publisher.publishProductDeleted({ productId })
  } catch (error) {
    logger.error(`Failed to publish product ${mutation} event for ${productId}.`, error)
  }
}
