import type { EventBridgeEvent, SQSEvent, SQSBatchResponse } from 'aws-lambda'
import { handleEventBridgeSqsBatch } from '../event-consumers/eventbridge-sqs-batch'
import { OrderNotificationWorkerService } from '../notifications/order-notification-worker.service'
import { createOrderNotificationWorkerApp } from '../worker.bootstrap'

interface OrderShippedEventDetail {
  orderId?: unknown
  shippedAt?: unknown
}

interface OrderCancelledEventDetail {
  orderId?: unknown
  cancelledAt?: unknown
}

let workerServicePromise: Promise<OrderNotificationWorkerService>

async function getWorkerService(): Promise<OrderNotificationWorkerService> {
  if (!workerServicePromise) {
    workerServicePromise = createOrderNotificationWorkerApp().then((app) =>
      app.get(OrderNotificationWorkerService),
    )
  }

  return workerServicePromise
}

async function handleEventBridgeEvent(
  event: EventBridgeEvent<
    'OrderShipped' | 'OrderCancelled',
    OrderShippedEventDetail | OrderCancelledEventDetail
  >,
): Promise<void> {
  const worker = await getWorkerService()
  if (event['detail-type'] === 'OrderCancelled') {
    await worker.handleOrderCancelledEvent(event.detail ?? {})
    return
  }

  await worker.handleOrderShippedEvent(event.detail ?? {})
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  return handleEventBridgeSqsBatch<
    'OrderShipped' | 'OrderCancelled',
    OrderShippedEventDetail | OrderCancelledEventDetail
  >(event, 'order-notification-worker', handleEventBridgeEvent)
}
